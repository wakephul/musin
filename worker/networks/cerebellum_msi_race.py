"""
Integrazione multisensoriale audiovisiva nel cervelletto: addestramento + test.

Rete: quella scelta dall'utente (microcircuito GR → PC_A/PC_B → DCN_A/DCN_B, IO_A).
Gli stimoli sensoriali VIS e AUD sono treni di Poisson che arrivano ai granuli (GR)
e, come collaterali delle fibre muscoidi, direttamente a DCN_A.

Addestramento. Ogni trial presenta VIS oppure AUD insieme al segnale di insegnamento
(US → IO_A, fibra rampicante). Dopo il trial le sinapsi GR → PC_A dei granuli che
hanno scaricato vengono depresse, ma solo se IO_A ha scaricato in quel trial (LTD
condizionata dalla fibra rampicante; NEST 3.8 non ha il volume transmitter di
CerebNEST, quindi la regola è applicata tra un trial e l'altro). PC_A smette così di
rispondere agli stimoli e di inibire DCN_A. PC_B non riceve insegnamento: continua
a inibire DCN_B.

Test (plasticità ferma). Trial V, A, AV e catch (30/30/30/10%). In AV i due treni
restano indipendenti e le loro conduttanze si sommano su DCN_A. Il peso MF → DCN_A è
tarato perché una sola modalità sia vicina alla soglia e le due insieme la superino
in fretta. Latenze del primo spike: uditivo 180 ms, visivo 220 ms (Cavadini et al. 2025).

Tempo di risposta: primo istante in cui la frequenza di una popolazione DCN supera
la sua baseline pre-stimolo di `threshold_delta_hz`. Sulle distribuzioni dei tempi
si calcola la Race Model Inequality (Miller 1982).
"""
import logging

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from worker import nest_utils
from worker.analysis import (
    binned_rate, cf_gated_ltd, ecdf, first_crossing, median_or_none, poisson_trains,
    race_model_inequality, snap, trailing_mean,
)
from worker.networks.generic import plot_differential, plot_population, plot_race_model
from worker.results import ResultStore

logger = logging.getLogger(__name__)

SIMULATION_CHUNK_MS = 500.0
TEST_CONDITIONS = (("V", ("VIS",), 0.3), ("A", ("AUD",), 0.3), ("AV", ("VIS", "AUD"), 0.3), ("CATCH", (), 0.1))
CONDITION_COLORS = {"V": "#2563eb", "A": "#b42318", "AV": "#0f6e6e", "CATCH": "#9a9a92"}

# Stimolo → GR: ogni granulo riceve 4 afferenze per modalità (come nel modello di riferimento).
MF_GR = {"indegree": 4, "weight": 2.0, "delay": 1.0}
MF_DCN_DELAY_MS = 20.0

# Plasticità PF → PC_A (stessi valori dell'esperimento di condizionamento).
LTD_PER_TRIAL = 1.5
LTP_PER_TRIAL = 0.00025

# Le reti salvate prima della correzione usavano i modelli EGLIF di CerebNEST, che hanno
# attività spontanea e non permettono di leggere un tempo di risposta: vengono sostituiti
# con gli iaf_cond_exp del modello di riferimento.
LEGACY_MODELS = {
    "eglif_pc_nestml": ("iaf_cond_exp", {"t_ref": 2.0, "C_m": 400.0, "V_th": -52.0, "V_reset": -70.0,
                                         "E_L": -70.0, "g_L": 16.0, "tau_syn_ex": 0.5, "tau_syn_in": 1.6}),
    "eglif_dcnp": ("iaf_cond_exp", {"t_ref": 1.0, "C_m": 2.0, "V_th": -40.0, "V_reset": -70.0,
                                    "E_L": -70.0, "g_L": 0.2, "tau_syn_ex": 0.5, "tau_syn_in": 10.0}),
    "eglif_io_nestml": ("parrot_neuron", {}),
}


def adapt_legacy_topology(topology: dict):
    """Restituisce (topologia, adattata). Senza modelli EGLIF la topologia resta com'è."""
    populations = topology.get("populations", [])
    if not any(pop["neuron_model"] in LEGACY_MODELS for pop in populations):
        return topology, False

    adapted_populations = []
    for pop in populations:
        model, params = LEGACY_MODELS.get(pop["neuron_model"], (pop["neuron_model"], pop.get("params", {})))
        adapted_populations.append({**pop, "neuron_model": model, "params": params})

    adapted_projections = []
    for proj in topology.get("projections", []):
        params = proj.get("params", {})
        if proj["source"].startswith("IO"):
            continue  # la fibra rampicante qui regola solo la plasticità
        if proj["source"].startswith("PC"):
            new_params = {"outdegree": params.get("outdegree", 1), "weight": -20.0, "delay": 1.0}
        else:
            new_params = {key: params[key] for key in ("indegree", "outdegree", "p", "delay") if key in params}
            new_params["weight"] = abs(float(params.get("weight", 4.0)))
        adapted_projections.append({**proj, "synapse_model": "static_synapse", "params": new_params})
    return {"populations": adapted_populations, "projections": adapted_projections}, True


def make_windows(n_trials: int, trial_ms: float, stim_ms: float, iti_range, rng, resolution: float, t_start: float):
    """Finestre (start, stim_end, end) dei trial con ITI uniforme. Restituisce (finestre, fine)."""
    windows, cursor = [], t_start
    for _ in range(n_trials):
        windows.append((snap(cursor, resolution), snap(cursor + stim_ms, resolution), snap(cursor + trial_ms, resolution)))
        cursor = snap(cursor + trial_ms + rng.uniform(float(iti_range[0]), float(iti_range[1])), resolution)
    return windows, cursor


def run_cerebellum_msi_race(task, sim_info, exp_params, minio_service, progress_cb):
    import nest

    store = ResultStore(minio_service, f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}")
    seed = int(exp_params.get("seed", 2016))
    resolution = float(exp_params.get("resolution", 0.1))
    rng = np.random.default_rng(seed)
    train_cfg = exp_params.get("train") or {}
    test_cfg = exp_params.get("test") or {}
    response_cfg = test_cfg.get("response") or {}

    latency = {"AUD": float(test_cfg.get("aud_latency_ms", 180.0)), "VIS": float(test_cfg.get("vis_latency_ms", 220.0))}
    rate = {"AUD": float(test_cfg.get("aud_rate", 20.0)), "VIS": float(test_cfg.get("vis_rate", 20.0))}
    n_sources = int(test_cfg.get("n_sources", 20))

    # --- Timeline ---
    n_train = int(train_cfg.get("n_trials", 45))
    train_windows, train_end = make_windows(
        n_train, float(train_cfg.get("trial_duration_ms", 1000.0)), float(train_cfg.get("stimulus_duration_ms", 600.0)),
        train_cfg.get("iti_range_ms") or [500, 1000], rng, resolution, 0.0)
    train_modalities = [("VIS", "AUD")[i % 2] for i in range(n_train)]
    rng.shuffle(train_modalities)

    n_test = int(test_cfg.get("n_trials", 100))
    test_windows, total_ms = make_windows(
        n_test, float(test_cfg.get("trial_duration_ms", 1000.0)), float(test_cfg.get("stimulus_duration_ms", 600.0)),
        test_cfg.get("iti_range_ms") or [200, 400], rng, resolution, train_end)
    weights = np.array([weight for _, _, weight in TEST_CONDITIONS])
    test_conditions = [TEST_CONDITIONS[i] for i in rng.choice(len(TEST_CONDITIONS), size=n_test, p=weights / weights.sum())]

    # --- Rete ---
    nest_utils.init_kernel(nest, resolution, seed)
    topology, adapted = adapt_legacy_topology(sim_info["network_definition"].get("topology", {}))
    if adapted:
        logger.warning("Rete con modelli EGLIF: sostituiti con iaf_cond_exp per questo esperimento")

    populations, recorders, sizes = {}, {}, {}
    for pop in topology["populations"]:
        nodes = nest_utils.create_population(nest, pop["neuron_model"], pop["size"], pop.get("params"))
        populations[pop["id"]] = nodes
        recorders[pop["id"]], sizes[pop["id"]] = nest_utils.record_spikes(nest, nodes)
    missing = [pop_id for pop_id in ("GR", "PC_A", "IO_A", "DCN_A", "DCN_B") if pop_id not in populations]
    if missing:
        raise ValueError(f"La rete non ha le popolazioni richieste dall'esperimento: {', '.join(missing)}")
    for proj in topology.get("projections", []):
        nest_utils.connect(nest, populations[proj["source"]], populations[proj["target"]],
                           proj.get("rule", "all_to_all"), proj.get("params"), proj.get("synapse_model", "static_synapse"))

    # --- Stimoli ---
    def stimulus_trains(modality: str) -> list:
        """Treni della modalità nei trial (di addestramento e di test) in cui è presente."""
        active = [w for w, m in zip(train_windows, train_modalities) if m == modality]
        active += [w for w, (_, devices, _) in zip(test_windows, test_conditions) if modality in devices]
        trains = [[] for _ in range(n_sources)]
        for start, stim_end, _ in active:
            # Se la latenza non entra nella finestra di stimolo viene ignorata.
            onset = start + latency[modality] if latency[modality] < stim_end - start else start
            for train, spikes in zip(trains, poisson_trains(rng, rate[modality], n_sources, onset, stim_end, resolution)):
                train.extend(spikes)
        return trains

    mf_dcn_weight = {"distribution": "uniform",
                     "low": float(test_cfg.get("mf_dcn_weight_low", 0.34)),
                     "high": float(test_cfg.get("mf_dcn_weight_high", 0.40))}
    for modality in ("VIS", "AUD"):
        generators = nest_utils.set_spike_trains(nest, stimulus_trains(modality))
        nest_utils.connect(nest, generators, populations["GR"], "fixed_indegree", dict(MF_GR))
        nest_utils.connect(nest, generators, populations["DCN_A"], "all_to_all",
                           {"weight": mf_dcn_weight, "delay": MF_DCN_DELAY_MS})

    # Segnale di insegnamento: Poisson su IO_A in una finestra di ogni trial di addestramento.
    us_from, us_to = train_cfg.get("us_window_ms") or [300.0, 600.0]
    us_trains = [[] for _ in range(int(train_cfg.get("us_n_sources", 10)))]
    for start, _, end in train_windows:
        window_trains = poisson_trains(rng, float(train_cfg.get("us_rate", 8.5)), len(us_trains),
                                       start + float(us_from), min(start + float(us_to), end), resolution)
        for train, spikes in zip(us_trains, window_trains):
            train.extend(spikes)
    nest_utils.connect(nest, nest_utils.set_spike_trains(nest, us_trains), populations["IO_A"], "all_to_all",
                       {"weight": 1.0, "delay": 1.0})

    # Registratori dedicati alla plasticità: tutti i granuli e tutta IO_A, svuotati a ogni trial.
    gr_activity = nest.Create("spike_recorder")
    nest.Connect(populations["GR"], gr_activity)
    cf_activity = nest.Create("spike_recorder")
    nest.Connect(populations["IO_A"], cf_activity)
    pf_pc = nest.GetConnections(populations["GR"], populations["PC_A"])
    pf_sources = np.asarray(pf_pc.get("source"))
    initial_weights = np.asarray(pf_pc.get("weight"), dtype=float)
    w_max = float(initial_weights.max()) * 1.5

    # --- Simulazione ---
    simulated = 0.0

    def simulate_until(t_end: float, phase: str) -> None:
        nonlocal simulated
        while simulated < t_end:
            chunk = snap(min(SIMULATION_CHUNK_MS, t_end - simulated), resolution)
            nest.Simulate(chunk)
            simulated = snap(simulated + chunk, resolution)
            progress_cb(min(simulated / total_ms, 1.0) * 90, phase)

    cf_trials = 0
    for index, (_, _, _) in enumerate(train_windows, start=1):
        next_start = train_windows[index][0] if index < n_train else train_end
        simulate_until(next_start, f"Addestramento {index}/{n_train}")
        if cf_activity.n_events > 0:
            cf_trials += 1
            active_granules = np.unique(gr_activity.get("events")["senders"])
            weights_now = np.asarray(pf_pc.get("weight"), dtype=float)
            pf_pc.set(weight=cf_gated_ltd(weights_now, np.isin(pf_sources, active_granules),
                                          LTD_PER_TRIAL, LTP_PER_TRIAL, 0.0, w_max).tolist())
        gr_activity.n_events = 0
        cf_activity.n_events = 0
    final_weights = np.asarray(pf_pc.get("weight"), dtype=float)
    # Da qui in poi i pesi non vengono più toccati: il test è a plasticità ferma.
    simulate_until(total_ms, "Test")

    # --- Risultati ---
    progress_cb(92, "Analisi")
    spikes = {pop_id: nest_utils.spike_events(recorder) for pop_id, recorder in recorders.items()}
    store.put_json("spikes.json", {
        "metadata": {"total_ms": total_ms, "train_end_ms": train_end, "seed": seed},
        "spikes": spikes,
    }, in_zip=False)
    for pop_id, events in spikes.items():
        plot_population(store, pop_id, events, sizes[pop_id], total_ms, train_end)
    plot_differential(store, "DCN_A", "DCN_B", "Uscita cerebellare", spikes, sizes, total_ms)

    # Frequenze DCN lisciate con media causale: un superamento non può precedere gli spike.
    bin_ms = float(response_cfg.get("bin_ms", 5.0))
    smooth_bins = int(response_cfg.get("smooth_bins", 5))
    baseline_ms = float(response_cfg.get("baseline_ms", 200.0))
    delta_hz = float(response_cfg.get("threshold_delta_hz", 15.0))
    dcn_rates = {}
    for pop_id in ("DCN_A", "DCN_B"):
        bin_starts, raw = binned_rate(spikes[pop_id]["times"], sizes[pop_id], bin_ms, total_ms)
        dcn_rates[pop_id] = trailing_mean(raw, smooth_bins)

    # Un trial ha una risposta se una popolazione DCN supera la propria baseline + delta;
    # se lo fanno entrambe vale la prima.
    labels = [label for label, _, _ in TEST_CONDITIONS]
    reaction_times = {label: [] for label in labels}
    trial_counts = {label: 0 for label in labels}
    detection = {"hits": 0, "misses": 0, "wrong_pathway": 0, "false_alarms": 0, "correct_rejections": 0}
    details = []
    times_a, times_b = np.asarray(spikes["DCN_A"]["times"]), np.asarray(spikes["DCN_B"]["times"])
    for index, ((start, _, end), (label, devices, _)) in enumerate(zip(test_windows, test_conditions), start=1):
        trial_counts[label] += 1
        response, winner = None, "none"
        for pop_id, smoothed in dcn_rates.items():
            before = (bin_starts >= start - baseline_ms) & (bin_starts < start)
            baseline = float(smoothed[before].mean()) if before.any() else 0.0
            crossing = first_crossing(bin_starts, smoothed, baseline + delta_hz, start, end)
            if crossing is not None and (response is None or crossing < response):
                response, winner = crossing, pop_id
        if response is not None:
            reaction_times[label].append(response - start)

        expected = "none" if label == "CATCH" else "DCN_A"
        outcome = ("correct_rejections" if winner == "none" else "false_alarms") if label == "CATCH" else \
                  ("hits" if winner == "DCN_A" else "misses" if winner == "none" else "wrong_pathway")
        detection[outcome] += 1
        details.append({
            "trial": index,
            "active_stimuli": list(devices),
            "condition_label": label,
            "expected_winner": expected,
            "actual_winner": winner,
            "is_correct": winner == expected,
            "response_time_ms": None if response is None else round(response - start, 1),
            "net_evidence": int(np.count_nonzero((times_a >= start) & (times_a <= end))
                                - np.count_nonzero((times_b >= start) & (times_b <= end))),
        })

    correct = detection["hits"] + detection["correct_rejections"]
    store.put_json("accuracy_metrics.json", {"metrics": [{
        "comparison": "Rilevazione dello stimolo su DCN_A (test)",
        "accuracy_percent": round(100.0 * correct / n_test, 2) if n_test else None,
        "total_valid_trials": n_test,
        "correct_trials": correct,
        "detection": detection,
        "trial_details": details,
    }]})

    # Race Model Inequality
    rmi_result = {
        "population": "DCN_A",
        "method": "rate_threshold_crossing",
        "threshold_delta_hz": delta_hz,
        "n_V": len(reaction_times["V"]), "n_A": len(reaction_times["A"]), "n_AV": len(reaction_times["AV"]),
        "trials": {label: trial_counts[label] for label in ("V", "A", "AV")},
        "median_rt_ms": {label: median_or_none(reaction_times[label]) for label in ("V", "A", "AV")},
        "max_rmi_violation": 0.0,
        "has_facilitation": False,
    }
    if all(reaction_times[label] for label in ("V", "A", "AV")):
        rmi = race_model_inequality(reaction_times["V"], reaction_times["A"], reaction_times["AV"],
                                    trial_counts["V"], trial_counts["A"], trial_counts["AV"], step_ms=bin_ms)
        plot_race_model(store, "rmi_DCN_A.png", rmi, reaction_times, trial_counts,
                        "Race Model Inequality: DCN", "Tempo di risposta (ms)")
        rmi_result["max_rmi_violation"] = round(rmi["max_violation"], 4)
        rmi_result["has_facilitation"] = rmi["max_violation"] > 0.05
    store.put_json("race_model.json", {"race_model": [rmi_result]})

    # Attivazione DCN e CDF dei tempi di risposta
    plot_activation(store, "activation_train_DCN_AB.png", "Attivazione DCN: addestramento", bin_starts, dcn_rates,
                    [(w, m[0]) for w, m in zip(train_windows, train_modalities)], 0.0, train_end)
    plot_activation(store, "activation_test_DCN_AB.png", "Attivazione DCN: test", bin_starts, dcn_rates,
                    [(w, label) for w, (label, _, _) in zip(test_windows, test_conditions)], train_end, total_ms)

    fig, ax = plt.subplots(figsize=(8, 5))
    trial_ms = test_windows[0][2] - test_windows[0][0]
    grid = np.arange(0.0, trial_ms + bin_ms, bin_ms)
    for label in ("V", "A", "AV"):
        ax.step(grid, ecdf(reaction_times[label], grid, trial_counts[label]), where="post",
                color=CONDITION_COLORS[label], lw=2,
                label=f"{label} ({len(reaction_times[label])}/{trial_counts[label]} risposte)")
    ax.set(title="Tempi di risposta per condizione", xlabel="Tempo dall'inizio del trial (ms)",
           ylabel="Frazione dei trial con risposta", ylim=(0, 1.05))
    ax.legend(fontsize=9)
    ax.grid(alpha=0.3)
    store.put_figure("cdf_test_DCN_AB.png", fig)

    store.put_json("response_times.json", {"populations": [
        {"pop_a": "train", "pop_b": "DCN_AB", "label": "Attivazione DCN: addestramento"},
        {"pop_a": "test", "pop_b": "DCN_AB", "label": "Attivazione DCN: test",
         "threshold_hz": delta_hz,
         "median_by_condition": {label: median_or_none(rts) for label, rts in reaction_times.items() if rts},
         "count_by_condition": {label: len(rts) for label, rts in reaction_times.items()},
         "trials_by_condition": trial_counts},
    ]})

    store.put_json("experiment_metrics.json", {
        "experiment": "cerebellum_msi_race",
        "network_adapted": adapted,
        "training": {
            "n_trials": n_train,
            "cf_trials": cf_trials,
            "weight_mean_before": round(float(initial_weights.mean()), 4),
            "weight_mean_after": round(float(final_weights.mean()), 4),
            "frac_depressed": round(float(np.mean(final_weights < 0.8 * initial_weights)), 4),
        },
    })
    store.close()
    progress_cb(100, "Completata")


def plot_activation(store, filename, title, bin_starts, dcn_rates, labelled_windows, t_from, t_to) -> None:
    fig, ax = plt.subplots(figsize=(12, 4.2))
    seen = set()
    for (start, stim_end, _), label in labelled_windows:
        ax.axvspan(start, stim_end, color=CONDITION_COLORS.get(label, "#9a9a92"), alpha=0.13,
                   label=None if label in seen else f"stimolo: {label}")
        seen.add(label)
    visible = (bin_starts >= t_from) & (bin_starts <= t_to)
    ax.plot(bin_starts[visible], dcn_rates["DCN_A"][visible], color="#0f6e6e", lw=1.2, label="DCN_A")
    ax.plot(bin_starts[visible], dcn_rates["DCN_B"][visible], color="#b42318", lw=1.2, label="DCN_B")
    ax.set(title=title, xlabel="Tempo (ms)", ylabel="Hz per neurone", xlim=(t_from, t_to))
    ax.legend(fontsize=8, ncol=6, loc="upper center", bbox_to_anchor=(0.5, -0.16), frameon=False)
    store.put_figure(filename, fig)
