"""Simulazione di una rete definita dall'utente (popolazioni + proiezioni) con
stimoli configurati dal pannello: a trial (protocollo) oppure continua (fasi)."""
import gc
import logging
from dataclasses import dataclass, field

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from backend.core.nest_models import SENSORY_STIMULUS, SPIKE_TRAIN_STIMULUS
from worker import nest_utils
from worker.analysis import (
    PAPER_PERCENTILES, binned_rate, decide, ecdf, first_crossing, median_or_none, percentiles,
    poisson_trains, race_model_inequality, snap, trailing_mean,
)
from worker.results import ResultStore

logger = logging.getLogger(__name__)

SIMULATION_CHUNK_MS = 500.0
PSTH_BIN_MS = 50.0
RESPONSE_SMOOTHING_BINS = 10
CONDITION_COLORS = plt.get_cmap("tab10")


@dataclass
class Trial:
    start: float
    stim_end: float
    end: float
    iti: float
    devices: list = field(default_factory=list)
    label: str = ""
    expected_winner: str | None = None


def build_trials(protocol: dict, rng, resolution: float) -> list:
    """Sequenza dei trial: condizione estratta dal pool secondo i pesi, ITI fisso o uniforme."""
    n_trials = int(protocol.get("num_trials", 1))
    trial_ms = float(protocol.get("trial_duration_ms", 1000.0))
    stim_ms = min(float(protocol.get("stimulus_duration_ms", trial_ms)), trial_ms)
    iti_range = protocol.get("iti_range_ms")
    pool = protocol.get("stimuli_pool") or []
    weights = np.array([float(entry.get("weight", 1.0)) for entry in pool])

    trials, cursor = [], 0.0
    for _ in range(n_trials):
        entry = pool[rng.choice(len(pool), p=weights / weights.sum())] if pool else {}
        if iti_range:
            iti = snap(rng.uniform(float(iti_range[0]), float(iti_range[1])), resolution)
        else:
            iti = snap(float(protocol.get("iti_ms", 0.0)), resolution)
        trials.append(Trial(
            start=snap(cursor, resolution),
            stim_end=snap(cursor + stim_ms, resolution),
            end=snap(cursor + trial_ms, resolution),
            iti=iti,
            devices=list(entry.get("devices", [])),
            label=str(entry.get("condition_label", "")),
            expected_winner=entry.get("expected_winner"),
        ))
        cursor = snap(cursor + trial_ms + iti, resolution)
    return trials


def stimulus_spike_trains(device: dict, trials: list, total_ms: float, rng, resolution: float, load_stimulus) -> list:
    """Treni di spike di un device: nei trial in cui è attivo, o su tutta la durata senza protocollo."""
    params = device.get("params") or {}
    windows = [(t.start, t.stim_end) for t in trials if device["id"] in t.devices] if trials else [(0.0, total_ms)]

    if device["model"] == SENSORY_STIMULUS:
        n_sources = int(params.get("n_sources", 1))
        trains = [[] for _ in range(n_sources)]
        for start, end in windows:
            for train, spikes in zip(trains, poisson_trains(rng, float(params.get("rate", 20.0)), n_sources, start, end, resolution)):
                train.extend(spikes)
        return trains

    # Treni registrati: i tempi sono relativi all'inizio della finestra di stimolo.
    recorded = load_stimulus(params.get("stimulus_id"))
    trains = [[] for _ in recorded]
    for start, end in windows:
        for train, spikes in zip(trains, recorded):
            train.extend(snap(start + t, resolution) for t in spikes if 0 < t <= end - start)
    return [sorted(set(train)) for train in trains]


def run_generic_experiment(sim_info, exp_params, storage, progress_cb):
    import nest

    topology = sim_info["network_definition"].get("topology", {})
    store = ResultStore(storage, f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}", sim_info.get("skip_files", ()))
    resolution = float(exp_params.get("resolution", 0.1))
    seed = int(exp_params.get("seed", 1234))
    rng = np.random.default_rng(seed)
    nest_utils.init_kernel(nest, resolution, seed)

    protocol = exp_params.get("protocol") or {}
    phases = exp_params.get("phases") or {}
    trials = build_trials(protocol, rng, resolution) if protocol else []
    train_ms = snap(float(phases.get("train_duration_ms", 0.0)), resolution)
    test_ms = snap(float(phases.get("test_duration_ms", 0.0)), resolution)
    total_ms = (trials[-1].end + trials[-1].iti) if trials else train_ms + test_ms
    if total_ms <= 0:
        raise ValueError("La simulazione non ha durata: servono un protocollo a trial oppure le fasi")

    # --- Rete ---
    populations, recorders, recorded_sizes = {}, {}, {}
    for pop in topology.get("populations", []):
        nodes = nest_utils.create_population(nest, pop["neuron_model"], pop["size"], pop.get("params"))
        populations[pop["id"]] = nodes
        if not nest_utils.is_stimulus_model(pop["neuron_model"]):
            recorders[pop["id"]], recorded_sizes[pop["id"]] = nest_utils.record_spikes(nest, nodes)

    for proj in topology.get("projections", []):
        for end in (proj["source"], proj["target"]):
            if end not in populations:
                raise ValueError(f"La proiezione {proj['source']} → {proj['target']} usa una popolazione inesistente: {end}")
        nest_utils.connect(
            nest, populations[proj["source"]], populations[proj["target"]],
            proj.get("rule", "all_to_all"), proj.get("params"), proj.get("synapse_model", "static_synapse"),
        )

    # --- Stimoli ---
    inputs = exp_params.get("inputs") or {}
    devices, switchable = {}, {}
    for device in inputs.get("devices", []):
        if device["model"] in (SENSORY_STIMULUS, SPIKE_TRAIN_STIMULUS):
            trains = stimulus_spike_trains(device, trials, total_ms, rng, resolution, sim_info["load_stimulus"])
            if trains:
                devices[device["id"]] = nest_utils.set_spike_trains(nest, trains)
        else:
            nest_utils.check_model(nest, device["model"], ("stimulator",))
            params = nest_utils.sanitize_params(nest, device.get("params") or {})
            devices[device["id"]] = nest.Create(device["model"], int(device.get("size", 1)), params=params)
            # Generatori NEST: nei protocolli a trial vanno accesi e spenti a mano.
            level = "rate" if "rate" in params else "amplitude" if "amplitude" in params else None
            if level:
                switchable[device["id"]] = (level, params[level])

    for conn in inputs.get("connections", []):
        if conn["source"] not in devices:
            continue  # device senza spike (es. mai attivo in nessun trial)
        if conn["target"] not in populations:
            raise ValueError(f"La connessione di stimolo punta a una popolazione inesistente: {conn['target']}")
        nest_utils.connect(
            nest, devices[conn["source"]], populations[conn["target"]],
            conn.get("rule", "all_to_all"), conn.get("params"), conn.get("synapse_model", "static_synapse"),
        )

    # --- Simulazione ---
    simulated = 0.0

    def simulate(duration: float, phase: str) -> None:
        nonlocal simulated
        remaining = snap(duration, resolution)
        while remaining > 0:
            chunk = min(SIMULATION_CHUNK_MS, remaining)
            nest.Simulate(chunk)
            remaining = snap(remaining - chunk, resolution)
            simulated += chunk
            progress_cb(min(simulated / total_ms, 1.0) * 90, phase)

    def switch_generators(active_ids) -> None:
        for device_id, (level, on_value) in switchable.items():
            devices[device_id].set({level: on_value if device_id in active_ids else 0.0})

    if trials:
        for index, trial in enumerate(trials, start=1):
            switch_generators(trial.devices)
            simulate(trial.stim_end - trial.start, f"Trial {index}/{len(trials)}: stimolo")
            switch_generators(())
            simulate(trial.end - trial.stim_end + trial.iti, f"Trial {index}/{len(trials)}: risposta")
    else:
        simulate(train_ms, "Addestramento")
        if test_ms > 0 and phases.get("disable_plasticity_during_test", True):
            freeze_plasticity(nest, topology.get("projections", []) + inputs.get("connections", []))
        simulate(test_ms, "Test")

    # --- Risultati ---
    progress_cb(92, "Analisi")
    spikes = {pop_id: nest_utils.spike_events(recorder) for pop_id, recorder in recorders.items()}
    store.put_json("spikes.json", {
        "metadata": {"simulation_id": sim_info["sim_id"], "total_ms": total_ms,
                     "train_end_ms": train_ms if not trials else None, "seed": seed},
        "spikes": spikes,
    }, in_zip=False)

    analysis = exp_params.get("analysis") or {}
    phase_boundary = train_ms if (not trials and train_ms > 0 and test_ms > 0) else None
    for pop_id, events in spikes.items():
        plot_population(store, pop_id, events, recorded_sizes[pop_id], total_ms, phase_boundary)
        gc.collect()

    pairs = [
        (cfg["pop_a"], cfg["pop_b"], cfg.get("label") or f"{cfg['pop_a']} − {cfg['pop_b']}")
        for cfg in analysis.get("differential_plots", [])
        if cfg.get("pop_a") in spikes and cfg.get("pop_b") in spikes
    ]
    for pop_a, pop_b, label in pairs:
        plot_differential(store, pop_a, pop_b, label, spikes, recorded_sizes, total_ms)

    if trials and pairs:
        margin = float(analysis.get("decision_margin", 0.0))
        store.put_json("accuracy_metrics.json", {"metrics": [
            decision_metrics(pop_a, pop_b, spikes, trials, margin) for pop_a, pop_b, _ in pairs
        ]})
        response_cfg = analysis.get("response_cdf") or {}
        if response_cfg.get("enabled", True):
            store.put_json("response_times.json", {"populations": [
                response_times(store, pop_a, pop_b, label, spikes, recorded_sizes, trials, total_ms, response_cfg)
                for pop_a, pop_b, label in pairs
            ]})

    race_cfg = analysis.get("race_model") or {}
    if trials and race_cfg.get("enabled"):
        results = [
            race_model(store, pop_id, spikes[pop_id]["times"], trials)
            for pop_id in race_cfg.get("populations", []) if pop_id in spikes
        ]
        results = [result for result in results if result]
        if results:
            store.put_json("race_model.json", {"race_model": results})

    store.close()
    progress_cb(100, "Completata")


def freeze_plasticity(nest, connections: list) -> None:
    """Azzera il tasso di apprendimento delle sinapsi plastiche (parametro `lambda` di stdp_synapse),
    nelle proiezioni della rete e nelle connessioni di stimolo."""
    for model in {conn.get("synapse_model", "static_synapse") for conn in connections}:
        if "lambda" in nest.GetDefaults(model):
            nest.GetConnections(synapse_model=model).set({"lambda": 0.0})


def plot_population(store, pop_id, events, n_recorded, total_ms, phase_boundary) -> None:
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.scatter(events["times"], events["senders"], s=1, color="#1c1c1a")
    ax.set(title=f"Raster: {pop_id}", xlabel="Tempo (ms)", ylabel="ID neurone", xlim=(0, total_ms))
    if phase_boundary:
        ax.axvline(phase_boundary, color="#b42318", ls="--", lw=1, label="Inizio test")
        ax.legend(fontsize=8)
    store.put_figure(f"{pop_id}_raster.png", fig)

    bin_starts, rate = binned_rate(events["times"], n_recorded, PSTH_BIN_MS, total_ms)
    fig, ax = plt.subplots(figsize=(10, 3))
    ax.bar(bin_starts, rate, width=PSTH_BIN_MS, align="edge", color="#0f6e6e")
    ax.set(title=f"Frequenza media: {pop_id}", xlabel="Tempo (ms)", ylabel="Hz per neurone", xlim=(0, total_ms))
    if phase_boundary:
        ax.axvline(phase_boundary, color="#b42318", ls="--", lw=1)
    store.put_figure(f"{pop_id}_histogram.png", fig)


def plot_differential(store, pop_a, pop_b, label, spikes, sizes, total_ms) -> None:
    bin_starts, rate_a = binned_rate(spikes[pop_a]["times"], sizes[pop_a], PSTH_BIN_MS, total_ms)
    _, rate_b = binned_rate(spikes[pop_b]["times"], sizes[pop_b], PSTH_BIN_MS, total_ms)
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(bin_starts, rate_a - rate_b, color="#0f6e6e", lw=1.2)
    ax.axhline(0, color="#1c1c1a", lw=0.8)
    ax.set(title=f"{label}: {pop_a} − {pop_b}", xlabel="Tempo (ms)", ylabel="Differenza di frequenza (Hz per neurone)")
    # Doppio underscore: gli id di popolazione contengono underscore singoli.
    store.put_figure(f"diff_{pop_a}__{pop_b}.png", fig)


def decision_metrics(pop_a, pop_b, spikes, trials, margin) -> dict:
    """Per ogni trial la popolazione con più spike; il trial conta solo se la condizione
    dichiara come risposta attesa una delle due popolazioni."""
    times_a = np.asarray(spikes[pop_a]["times"])
    times_b = np.asarray(spikes[pop_b]["times"])
    details, correct, valid = [], 0, 0
    for index, trial in enumerate(trials, start=1):
        spikes_a = int(np.count_nonzero((times_a >= trial.start) & (times_a <= trial.end)))
        spikes_b = int(np.count_nonzero((times_b >= trial.start) & (times_b <= trial.end)))
        winner = decide(spikes_a, spikes_b, pop_a, pop_b, margin)
        is_correct = None
        if trial.expected_winner in (pop_a, pop_b):
            valid += 1
            is_correct = winner == trial.expected_winner
            correct += is_correct
        details.append({
            "trial": index,
            "active_stimuli": trial.devices,
            "condition_label": trial.label,
            "expected_winner": trial.expected_winner or "none",
            "actual_winner": winner,
            "is_correct": is_correct,
            "net_evidence": spikes_a - spikes_b,
        })
    return {
        "comparison": f"{pop_a} − {pop_b}",
        "accuracy_percent": round(100.0 * correct / valid, 2) if valid else None,
        "total_valid_trials": valid,
        "correct_trials": correct,
        "trial_details": details,
    }


def response_times(store, pop_a, pop_b, label, spikes, sizes, trials, total_ms, cfg) -> dict:
    """Tempo di risposta di un trial: primo istante in cui |freq_A − freq_B| supera la soglia."""
    bin_ms = float(cfg.get("bin_size", 5.0))
    threshold = float(cfg.get("threshold", 15.0))
    bin_starts, rate_a = binned_rate(spikes[pop_a]["times"], sizes[pop_a], bin_ms, total_ms)
    _, rate_b = binned_rate(spikes[pop_b]["times"], sizes[pop_b], bin_ms, total_ms)
    rate_a = trailing_mean(rate_a, RESPONSE_SMOOTHING_BINS)
    rate_b = trailing_mean(rate_b, RESPONSE_SMOOTHING_BINS)
    difference = rate_a - rate_b

    by_condition, trial_counts, rows = {}, {}, []
    for index, trial in enumerate(trials, start=1):
        condition = trial.label or "senza etichetta"
        trial_counts[condition] = trial_counts.get(condition, 0) + 1
        by_condition.setdefault(condition, [])
        crossing = first_crossing(bin_starts, np.abs(difference), threshold, trial.start, trial.end)
        winner = "none"
        if crossing is not None:
            by_condition[condition].append(crossing - trial.start)
            winner = pop_a if difference[np.searchsorted(bin_starts, crossing)] > 0 else pop_b
        rows.append({
            "trial": index,
            "condition": condition,
            "response_time_ms": None if crossing is None else round(crossing - trial.start, 1),
            "winner": winner,
        })
    colors = {condition: CONDITION_COLORS(i % 10) for i, condition in enumerate(by_condition)}

    fig, ax = plt.subplots(figsize=(12, 4.5))
    labelled = set()
    for trial in trials:
        condition = trial.label or "senza etichetta"
        ax.axvspan(trial.start, trial.stim_end, color=colors[condition], alpha=0.15,
                   label=None if condition in labelled else f"stimolo: {condition}")
        labelled.add(condition)
    ax.plot(bin_starts, rate_a, color="#0f6e6e", lw=1.2, label=pop_a)
    ax.plot(bin_starts, rate_b, color="#b42318", lw=1.2, label=pop_b)
    ax.set(title=f"Attivazione per condizione: {label}", xlabel="Tempo (ms)", ylabel="Hz per neurone")
    ax.legend(fontsize=8, ncol=6, loc="upper center", bbox_to_anchor=(0.5, -0.14), frameon=False)
    store.put_figure(f"activation_{pop_a}_{pop_b}.png", fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    trial_ms = trials[0].end - trials[0].start
    grid = np.arange(0.0, trial_ms + bin_ms, bin_ms)
    for condition, rts in by_condition.items():
        ax.step(grid, ecdf(rts, grid, trial_counts[condition]), where="post", color=colors[condition],
                label=f"{condition} ({len(rts)}/{trial_counts[condition]} risposte)")
    ax.set(title=f"Tempi di risposta: {label}", xlabel="Tempo dall'inizio del trial (ms)",
           ylabel="Frazione dei trial con risposta", ylim=(0, 1.05))
    ax.legend(fontsize=9)
    ax.grid(alpha=0.3)
    store.put_figure(f"cdf_{pop_a}_{pop_b}.png", fig)

    return {
        "label": label,
        "pop_a": pop_a,
        "pop_b": pop_b,
        "threshold_hz": threshold,
        "median_by_condition": {c: median_or_none(rts) for c, rts in by_condition.items() if rts},
        "count_by_condition": {c: len(rts) for c, rts in by_condition.items()},
        "trials_by_condition": trial_counts,
        "response_times_by_condition": {c: [round(rt, 1) for rt in rts] for c, rts in by_condition.items()},
        "trials": rows,
    }


def race_model(store, pop_id, times, trials):
    """Race Model Inequality sulla latenza del primo spike della popolazione, per le condizioni V, A e AV."""
    times = np.asarray(times)
    latencies, trial_counts = {"V": [], "A": [], "AV": []}, {"V": 0, "A": 0, "AV": 0}
    for trial in trials:
        if trial.label not in latencies:
            continue
        trial_counts[trial.label] += 1
        in_trial = times[(times >= trial.start) & (times <= trial.end)]
        if len(in_trial):
            latencies[trial.label].append(float(in_trial.min() - trial.start))
    result = {
        "population": pop_id,
        "method": "first_spike_latency",
        "n_V": len(latencies["V"]), "n_A": len(latencies["A"]), "n_AV": len(latencies["AV"]),
        "trials": trial_counts,
        "median_rt_ms": {condition: median_or_none(values) for condition, values in latencies.items()},
        "reaction_times_ms": {condition: [round(v, 1) for v in values] for condition, values in latencies.items()},
        "max_rmi_violation": 0.0,
        "p_value": None,
        "has_facilitation": False,
    }
    if not all(latencies.values()):
        # Il risultato resta, con i conteggi: la pagina dice quale condizione è senza risposte.
        logger.warning("Race model su %s non calcolato: servono risposte nelle condizioni V, A e AV", pop_id)
        return result

    rmi = race_model_inequality(latencies["V"], latencies["A"], latencies["AV"],
                                trial_counts["V"], trial_counts["A"], trial_counts["AV"])
    plot_race_model(store, f"rmi_{pop_id}.png", rmi, latencies, trial_counts,
                    f"Race Model Inequality: {pop_id}", "Latenza del primo spike (ms)")
    return {**result, "max_rmi_violation": round(rmi["max_violation"], 4), "p_value": rmi["p_value"],
            "has_facilitation": rmi["significant"]}


def plot_percentile_cdf(store, filename, title, series: dict) -> None:
    """Distribuzioni dei tempi di risposta ai percentili 5-95, come nella Fig. 9 di
    Cavadini et al. (2025). `series`: etichetta → (tempi, stile matplotlib, colore, riempimento)."""
    fig, ax = plt.subplots(figsize=(7, 6))
    levels = np.array(PAPER_PERCENTILES) / 100.0
    for label, (rts, style, color, fill) in series.items():
        if len(rts):
            ax.plot(percentiles(rts), levels, style, color=color, markerfacecolor=fill, markersize=7, lw=2,
                    label=f"{label} (n={len(rts)})")
    ax.set(title=title, xlabel="Tempo di risposta (ms)", ylabel="Probabilità cumulativa", ylim=(0, 1))
    ax.set_yticks(np.arange(0.0, 1.01, 0.1))
    ax.legend(fontsize=9, loc="lower right")
    ax.grid(alpha=0.3)
    store.put_figure(filename, fig)


def plot_race_model(store, filename, rmi, rts, trial_counts, title, xlabel) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    t = rmi["time_ms"]
    for key, condition, color in (("cdf_v", "V", "#2563eb"), ("cdf_a", "A", "#b42318"), ("cdf_av", "AV", "#0f6e6e")):
        ax1.step(t, rmi[key], where="post", color=color, lw=2,
                 label=f"{condition} ({len(rts[condition])}/{trial_counts[condition]} risposte)")
    ax1.step(t, rmi["bound"], where="post", color="#1c1c1a", ls="--", lw=1.5, label="Limite di Miller: min(1, V + A)")
    ax1.fill_between(t, rmi["bound"], rmi["cdf_av"], where=rmi["cdf_av"] > rmi["bound"], step="post",
                     alpha=0.2, color="#0f6e6e", label="Violazione")
    ax1.set(title=title, xlabel=xlabel, ylabel="Frazione dei trial con risposta", ylim=(-0.05, 1.05))
    ax1.legend(fontsize=9)
    ax1.grid(alpha=0.3)

    ax2.step(t, rmi["violation"], where="post", color="#0f6e6e", lw=2)
    ax2.axhline(0, color="#1c1c1a", lw=1, ls="--")
    ax2.fill_between(t, 0, rmi["violation"], where=rmi["violation"] > 0, step="post", alpha=0.3, color="#0f6e6e")
    ax2.set(title="AV − limite di Miller (positivo = violazione)", xlabel=xlabel, ylabel="Differenza")
    ax2.grid(alpha=0.3)
    fig.tight_layout()
    store.put_figure(filename, fig)
