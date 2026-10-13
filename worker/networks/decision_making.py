"""
Decisione audiovisiva: rete attrattore a due popolazioni (Wang), port NEST 2.18 → 3.8
del modello `decision_making_nrp.py`.

  * Due popolazioni eccitatorie in competizione (A, B) e un pool inibitorio comune,
    su `iaf_psc_exp_multisynapse` con recettori rumore / AMPA / NMDA / GABA e pesi
    normalizzati sul PSP.
  * L'evidenza sensoriale è un treno di Poisson per afferenza, con latenza del primo
    spike per modalità (uditivo 150 ms, visivo 220 ms). Nella condizione audiovisiva
    le due modalità arrivano sulle stesse afferenze: l'evidenza inizia prima ed è
    più densa.
  * Ogni trial stimola un solo lato (A o B, bilanciati). Il tempo di risposta è il
    primo istante in cui la frequenza di una delle due popolazioni sale sopra soglia;
    la risposta è corretta se a salire è la popolazione stimolata.

Modalità `dual` (modello acerebellare di Cavadini et al. 2025): due reti indipendenti,
una uditiva e una visiva, ricevono gli stessi trial; la risposta audiovisiva è quella
della rete più veloce (modello a gara). Mandare le due modalità sulla stessa rete
(`audiovisual`) la satura, per questo il paper usa due reti.

Ogni trial ha una realizzazione di Poisson indipendente (il codice originale
riusava lo stesso treno in tutti i trial).
"""

import logging

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.special import lambertw

from backend.services.experiments import DECISION_DEFAULTS
from worker import nest_utils
from worker.analysis import (
    PAPER_PERCENTILES, binned_rate, ecdf, first_upward_crossing, median_or_none, paired_race,
    percentiles, poisson_trains, race_model_inequality, trailing_mean,
)
from worker.networks.generic import plot_percentile_cdf, plot_population
from worker.results import ResultStore

logger = logging.getLogger(__name__)

SIMULATION_CHUNK_MS = 500.0

# Default decision network parameters — from
# data/config/networks/decision_making_nrp.json (NEST 2.18 reference).
DEFAULT_NETWORK_PARAMS = {
    "order": 400.0,
    "rec_pop": 1.0,
    "dt": 0.1,
    "J": 0.04,
    "eta_ex": 0.96,
    "eta_in": 0.90,
    "ratio_stim_rate": 10.0,
    "std_ratio": 16.0,
    "std_noise": 200.0,
    "w_plus": 1.70,
    "w_minus": 0.80,
    "w_plus_NMDA": 4.25,
    "tau_m_ex": 20.0,
    "tau_m_in": 10.0,
    "C_m_ex": 500.0,
    "C_m_in": 200.0,
    "V_membrane": -70.0,
    "V_threshold": -50.0,
    "V_reset": -55.0,
    "t_ref_ex": 2.0,
    "t_ref_in": 1.0,
    "tau_syn_noise": 5.0,
    "tau_syn_AMPA": 2.0,
    "tau_syn_NMDA": 100.0,
    "tau_syn_GABA": 5.0,
    "epsilon_ex_AB_BA": 0.20,
    "epsilon_ex_reccurent": 0.40,
    "epsilon_ex_AI_BI": 0.40,
    "epsilon_in_IA_IB": 0.45,
    "epsilon_in_recurrent": 0.30,
    "delay_noise": 0.50,
    "delay_AMPA": 0.50,
    "delay_GABA": 0.50,
    "delay_NMDA": 2.50,
}

# Default experiment knobs — from execution_types.json + the legacy run loop.
DEFAULT_EXPERIMENT = {
    "modality": DECISION_DEFAULTS["modality"],   # auditory | visual | audiovisual | dual (due reti, vince la più veloce)
    "rate": 30.0,                # Hz of the sensory Poisson drive
    "number_of_neurons": 80,     # sensory afferents per side
    "stimulus_window_ms": 600.0, # stimulus is active within [latency, window]
    # L'attività persistente dell'attrattore dura circa 2 s dopo lo stimolo: con trial
    # più corti il vincitore del trial precedente sopprime la risposta al successivo.
    "trial_slot_ms": DECISION_DEFAULTS["trial_slot_ms"],
    "num_trials": DECISION_DEFAULTS["num_trials"],
    "threshold": 15.0,           # Hz; rate crossing that defines a response
    "rt_smooth_bins": 5,         # finestra (in bin) della media mobile causale usata per la risposta, come nel paper
    "auditory_latency_ms": 150.0,
    "visual_latency_ms": 220.0,
    "bin_size_ms": 5.0,
    "seed": 1234,
    "order": 400,                # network size scale (legacy = 400)
}


def _lambert_wm1(x: float) -> float:
    return float(lambertw(x, k=-1).real)


def _compute_psp_norm(tau_mem: float, C_mem: float, tau_syn: float) -> float:
    """PSP normalization (legacy ComputePSPNorm) using scipy LambertW."""
    a = tau_mem / tau_syn
    b = 1.0 / tau_syn - 1.0 / tau_mem
    t_max = 1.0 / b * (-_lambert_wm1(-np.exp(-1.0 / a) / a) - 1.0 / a)
    return float(
        np.exp(1.0)
        / (
            tau_syn
            * (C_mem * b)
            * (
                (np.exp(-t_max / tau_mem) - np.exp(-t_max / tau_syn)) / b
                - t_max * np.exp(-t_max / tau_syn)
            )
        )
    )


# ----------------------------------------------------------------------------
# Network
# ----------------------------------------------------------------------------

def _build_network(nest, par, trains_a, trains_b, rng):
    """Costruisce l'attrattore di Wang e collega gli stimoli. Restituisce i registratori
    di spike delle tre popolazioni e il numero di neuroni di ciascuna."""
    order = int(par["order"])
    NA = NB = 2 * order
    NI = 1 * order

    tau_syn = [par["tau_syn_noise"], par["tau_syn_AMPA"], par["tau_syn_NMDA"], par["tau_syn_GABA"]]

    exc_params = {
        "E_L": par["V_membrane"], "V_th": par["V_threshold"], "V_reset": par["V_reset"],
        "C_m": par["C_m_ex"], "tau_m": par["tau_m_ex"], "t_ref": par["t_ref_ex"], "tau_syn": tau_syn,
    }
    inh_params = {
        "E_L": par["V_membrane"], "V_th": par["V_threshold"], "V_reset": par["V_reset"],
        "C_m": par["C_m_in"], "tau_m": par["tau_m_in"], "t_ref": par["t_ref_in"], "tau_syn": tau_syn,
    }

    nest.CopyModel("iaf_psc_exp_multisynapse", "excitatory_pop", params=exc_params)
    nest.CopyModel("iaf_psc_exp_multisynapse", "inhibitory_pop", params=inh_params)
    pop_A = nest.Create("excitatory_pop", NA)
    pop_B = nest.Create("excitatory_pop", NB)
    pop_inh = nest.Create("inhibitory_pop", NI)

    J = par["J"]
    J_norm_noise = J / _compute_psp_norm(par["tau_m_ex"], par["C_m_ex"], par["tau_syn_noise"])
    J_norm_AMPA = J / _compute_psp_norm(par["tau_m_ex"], par["C_m_ex"], par["tau_syn_AMPA"])
    J_norm_NMDA = 0.05  # fixed (tau_syn_NMDA > tau_m_ex -> PSP norm undefined)
    J_norm_GABA = J / _compute_psp_norm(par["tau_m_in"], par["C_m_in"], par["tau_syn_GABA"])

    # Background noise drive (computed rates, legacy formulas)
    nu_th_ex = (abs(par["V_threshold"]) * par["C_m_ex"]) / (J_norm_noise * np.exp(1) * par["tau_m_ex"] * par["tau_syn_noise"])
    p_rate_ex = 1000.0 * par["eta_ex"] * nu_th_ex
    nu_th_in = (abs(par["V_threshold"]) * par["C_m_in"]) / (J_norm_noise * np.exp(1) * par["tau_m_in"] * par["tau_syn_noise"])
    p_rate_in = 1000.0 * par["eta_in"] * nu_th_in

    PG_noise_A = nest.Create("poisson_generator")
    PG_noise_B = nest.Create("poisson_generator")
    PG_noise_inh = nest.Create("poisson_generator")

    nest.CopyModel("static_synapse", "noise_syn", {"weight": J_norm_noise, "delay": par["delay_noise"]})
    noise_syn = {"synapse_model": "noise_syn", "receptor_type": 1}
    nest.Connect(PG_noise_A, pop_A, syn_spec=noise_syn)
    nest.Connect(PG_noise_B, pop_B, syn_spec=noise_syn)
    nest.Connect(PG_noise_inh, pop_inh, syn_spec=noise_syn)

    # Stimolo sensoriale: uno spike_generator per afferenza, all_to_all sulla popolazione.
    PG_input_A = nest_utils.set_spike_trains(nest, trains_a)
    PG_input_B = nest_utils.set_spike_trains(nest, trains_b)

    nest.CopyModel("static_synapse", "AMPA_input", {"weight": J_norm_AMPA, "delay": par["delay_AMPA"]})
    AMPA_input_syn = {"synapse_model": "AMPA_input", "receptor_type": 2}
    nest.Connect(PG_input_A, pop_A, syn_spec=AMPA_input_syn)
    nest.Connect(PG_input_B, pop_B, syn_spec=AMPA_input_syn)

    # Synapse models for the recurrent / competitive structure
    nest.CopyModel("static_synapse", "AMPA_AB_BA", {"weight": J_norm_AMPA * par["w_minus"], "delay": par["delay_AMPA"]})
    nest.CopyModel("static_synapse", "NMDA_AB_BA", {"weight": J_norm_NMDA * par["w_minus"], "delay": par["delay_NMDA"]})
    nest.CopyModel("static_synapse", "AMPA_AI_BI", {"weight": J_norm_AMPA * par["w_plus"], "delay": par["delay_AMPA"]})
    nest.CopyModel("static_synapse", "NMDA_AI_BI", {"weight": J_norm_NMDA * par["w_plus"], "delay": par["delay_NMDA"]})
    nest.CopyModel("static_synapse", "GABA_IA_IB", {"weight": -J_norm_GABA * par["w_plus"], "delay": par["delay_GABA"]})
    nest.CopyModel("static_synapse", "AMPA_rec", {"weight": J_norm_AMPA, "delay": par["delay_AMPA"]})
    nest.CopyModel("static_synapse", "NMDA_rec", {"weight": J_norm_NMDA * par["w_plus_NMDA"], "delay": par["delay_NMDA"]})
    nest.CopyModel("static_synapse", "GABA_rec", {"weight": -J_norm_GABA, "delay": par["delay_GABA"]})

    s_AMPA_AB = {"synapse_model": "AMPA_AB_BA", "receptor_type": 2}
    s_NMDA_AB = {"synapse_model": "NMDA_AB_BA", "receptor_type": 3}
    s_AMPA_AI = {"synapse_model": "AMPA_AI_BI", "receptor_type": 2}
    s_NMDA_AI = {"synapse_model": "NMDA_AI_BI", "receptor_type": 3}
    s_GABA_IA = {"synapse_model": "GABA_IA_IB", "receptor_type": 4}
    s_AMPA_rec = {"synapse_model": "AMPA_rec", "receptor_type": 2}
    s_NMDA_rec = {"synapse_model": "NMDA_rec", "receptor_type": 3}
    s_GABA_rec = {"synapse_model": "GABA_rec", "receptor_type": 4}

    c_AB = {"rule": "pairwise_bernoulli", "p": par["epsilon_ex_AB_BA"]}
    c_rec = {"rule": "pairwise_bernoulli", "p": par["epsilon_ex_reccurent"]}
    c_AI = {"rule": "pairwise_bernoulli", "p": par["epsilon_ex_AI_BI"]}
    c_IA = {"rule": "pairwise_bernoulli", "p": par["epsilon_in_IA_IB"]}
    c_Irec = {"rule": "pairwise_bernoulli", "p": par["epsilon_in_recurrent"]}

    # pop A
    nest.Connect(pop_A, pop_A, c_rec, s_AMPA_rec)
    nest.Connect(pop_A, pop_A, c_rec, s_NMDA_rec)
    nest.Connect(pop_A, pop_B, c_AB, s_AMPA_AB)
    nest.Connect(pop_A, pop_B, c_AB, s_NMDA_AB)
    nest.Connect(pop_A, pop_inh, c_AI, s_AMPA_AI)
    nest.Connect(pop_A, pop_inh, c_AI, s_NMDA_AI)
    # pop B
    nest.Connect(pop_B, pop_B, c_rec, s_AMPA_rec)
    nest.Connect(pop_B, pop_B, c_rec, s_NMDA_rec)
    nest.Connect(pop_B, pop_A, c_AB, s_AMPA_AB)
    nest.Connect(pop_B, pop_A, c_AB, s_NMDA_AB)
    nest.Connect(pop_B, pop_inh, c_AI, s_AMPA_AI)
    nest.Connect(pop_B, pop_inh, c_AI, s_NMDA_AI)
    # pop inh
    nest.Connect(pop_inh, pop_inh, c_Irec, s_GABA_rec)
    nest.Connect(pop_inh, pop_A, c_IA, s_GABA_IA)
    nest.Connect(pop_inh, pop_B, c_IA, s_GABA_IA)

    # Frequenza del rumore di fondo: un campione per popolazione, come nell'originale.
    nest.SetStatus(PG_noise_A, {"rate": float(rng.normal(p_rate_ex, p_rate_ex / par["std_noise"]))})
    nest.SetStatus(PG_noise_B, {"rate": float(rng.normal(p_rate_ex, p_rate_ex / par["std_noise"]))})
    nest.SetStatus(PG_noise_inh, {"rate": float(rng.normal(p_rate_in, p_rate_in / par["std_noise"]))})

    # rec_pop: frazione di ogni popolazione da registrare (1.0 = tutti i neuroni).
    recorders = {}
    for pop_id, nodes in (("pop_A", pop_A), ("pop_B", pop_B), ("pop_inh", pop_inh)):
        recorded = nodes[:max(1, min(len(nodes), int(float(par["rec_pop"]) * len(nodes))))]
        recorder = nest.Create("spike_recorder")
        nest.Connect(recorded, recorder)
        recorders[pop_id] = (recorder, len(recorded))
    return recorders


MODALITY_NAMES = {"auditory": "uditiva", "visual": "visiva", "audiovisual": "audiovisiva"}


def _run_network(nest, name, cfg, par, sides, seed, store, prefix, progress):
    """Simula una rete di decisione che riceve la modalità `name` e legge un tempo di
    risposta per trial. Restituisce (tempi per trial con None se manca, dettagli, frequenze medie)."""
    rng = np.random.default_rng(seed)
    latencies = [float(cfg[f"{m}_latency_ms"]) for m in ("auditory", "visual") if name in (m, "audiovisual")]
    trial_ms = float(cfg["trial_slot_ms"])
    window_ms = float(cfg["stimulus_window_ms"])
    threshold = float(cfg["threshold"])
    bin_ms = float(cfg["bin_size_ms"])
    total_ms = trial_ms * len(sides)
    resolution = float(par["dt"])

    n_afferents = int(cfg["number_of_neurons"])
    trains = {"pop_A": [[] for _ in range(n_afferents)], "pop_B": [[] for _ in range(n_afferents)]}
    for index, side in enumerate(sides):
        start = index * trial_ms
        for latency in latencies:
            trial_trains = poisson_trains(rng, float(cfg["rate"]), n_afferents, start + latency, start + window_ms, resolution)
            for train, spikes in zip(trains[side], trial_trains):
                train.extend(spikes)
    trains = {side: [sorted(set(train)) for train in side_trains] for side, side_trains in trains.items()}

    nest_utils.init_kernel(nest, resolution, seed)
    recorders = _build_network(nest, par, trains["pop_A"], trains["pop_B"], rng)
    simulated = 0.0
    while simulated < total_ms:
        chunk = min(SIMULATION_CHUNK_MS, total_ms - simulated)
        nest.Simulate(chunk)
        simulated += chunk
        progress(simulated / total_ms, f"Rete {MODALITY_NAMES[name]}: {simulated / 1000:.1f} di {total_ms / 1000:.1f} s")

    spikes = {pop_id: nest_utils.spike_events(recorder) for pop_id, (recorder, _) in recorders.items()}
    sizes = {pop_id: size for pop_id, (_, size) in recorders.items()}
    for pop_id, events in spikes.items():
        plot_population(store, f"{prefix}{pop_id}", events, sizes[pop_id], total_ms, None)

    rates = {}
    for pop_id in ("pop_A", "pop_B"):
        bin_starts, raw = binned_rate(spikes[pop_id]["times"], sizes[pop_id], bin_ms, total_ms)
        rates[pop_id] = trailing_mean(raw, int(cfg["rt_smooth_bins"]))

    # Risposta di un trial: la prima popolazione che sale sopra soglia dopo l'arrivo dello stimolo.
    response_times, details = [], []
    spike_times = {pop_id: np.asarray(spikes[pop_id]["times"]) for pop_id in ("pop_A", "pop_B")}
    for index, side in enumerate(sides):
        start = index * trial_ms
        in_trial = {pop_id: int(np.count_nonzero((times >= start) & (times < start + trial_ms)))
                    for pop_id, times in spike_times.items()}
        response, winner = None, "none"
        for pop_id, rate in rates.items():
            crossing = first_upward_crossing(bin_starts, rate, threshold, start + min(latencies), start + trial_ms)
            if crossing is not None and (response is None or crossing < response):
                response, winner = crossing, pop_id
        response_times.append(response - start if winner == side else None)
        details.append({
            "trial": index + 1,
            "active_stimuli": [side],
            "condition_label": name,
            "expected_winner": side,
            "actual_winner": winner,
            "is_correct": winner == side,
            "response_time_ms": None if response is None else round(response - start, 1),
            "net_evidence": in_trial["pop_A"] - in_trial["pop_B"],
        })

    fig, ax = plt.subplots(figsize=(11, 4))
    for index, side in enumerate(sides):
        ax.axvspan(index * trial_ms, index * trial_ms + window_ms, alpha=0.08,
                   color="#0f6e6e" if side == "pop_A" else "#b42318")
    ax.plot(bin_starts, rates["pop_A"], color="#0f6e6e", lw=1.3, label="pop_A")
    ax.plot(bin_starts, rates["pop_B"], color="#b42318", lw=1.3, label="pop_B")
    ax.axhline(threshold, color="#1c1c1a", ls="--", lw=1, label=f"Soglia ({threshold:g} Hz)")
    ax.set(title=f"Rete {MODALITY_NAMES[name]}: competizione tra pop_A e pop_B (sfondo: lato stimolato)",
           xlabel="Tempo (ms)", ylabel="Hz per neurone")
    ax.legend(fontsize=9, loc="upper right")
    store.put_figure(f"exp_competizione_rete_{MODALITY_NAMES[name]}.png", fig)

    mean_rate = {pop_id: round(len(spikes[pop_id]["times"]) * 1000.0 / total_ms / sizes[pop_id], 2) for pop_id in spikes}
    return response_times, details, mean_rate, spikes


def run_decision_making_experiment(sim_info, exp_params, storage, progress_cb):
    import nest

    cfg = {**DEFAULT_EXPERIMENT, **(exp_params.get("decision_making") or {})}
    par = {**DEFAULT_NETWORK_PARAMS, **(exp_params.get("network_overrides") or {}), "order": int(cfg["order"])}
    store = ResultStore(storage, f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}")
    seed = int(cfg["seed"])

    modality = cfg["modality"]
    if modality not in ("auditory", "visual", "audiovisual", "dual"):
        raise ValueError(f"Modalità sconosciuta: {modality}")
    networks = ["auditory", "visual"] if modality == "dual" else [modality]
    num_trials = int(cfg["num_trials"])
    trial_ms = float(cfg["trial_slot_ms"])
    bin_ms = float(cfg["bin_size_ms"])

    # Lato stimolato per trial, bilanciato e in ordine casuale: lo stesso per tutte le reti.
    sides = [("pop_A", "pop_B")[i % 2] for i in range(num_trials)]
    np.random.default_rng(seed).shuffle(sides)

    results, all_spikes = {}, {}
    for index, name in enumerate(networks):
        prefix = f"{name}_" if modality == "dual" else ""
        share = lambda fraction, phase, index=index: progress_cb(5 + 85 * (index + fraction) / len(networks), phase)
        # Seed diversi: due reti con lo stesso rumore di fondo non sarebbero indipendenti.
        rts, details, mean_rate, spikes = _run_network(nest, name, cfg, par, sides, seed + index, store, prefix, share)
        results[name] = {"response_times": rts, "details": details, "mean_rate": mean_rate}
        all_spikes.update({f"{prefix}{pop_id}": events for pop_id, events in spikes.items()})

    progress_cb(92, "Analisi")
    store.put_json("spikes.json", {
        "metadata": {"simulation_id": sim_info["sim_id"], "total_ms": trial_ms * num_trials, "seed": seed},
        "spikes": all_spikes,
    }, in_zip=False)

    store.put_json("accuracy_metrics.json", {"metrics": [{
        "comparison": f"Rete {MODALITY_NAMES[name]}: popolazione stimolata contro popolazione che risponde per prima",
        "accuracy_percent": round(100.0 * sum(row["is_correct"] for row in outcome["details"]) / num_trials, 2) if num_trials else None,
        "total_valid_trials": num_trials,
        "correct_trials": sum(row["is_correct"] for row in outcome["details"]),
        "trial_details": outcome["details"],
    } for name, outcome in results.items()]})

    answered = {name: [rt for rt in outcome["response_times"] if rt is not None] for name, outcome in results.items()}
    series = {
        "auditory": ("Uditivo", "--s", "#1c1c1a", "#1c1c1a"),
        "visual": ("Visivo", "--o", "#1c1c1a", "#1c1c1a"),
        "audiovisual": ("Audiovisivo", "-D", "#0f6e6e", "#ffffff"),
    }
    curves = {series[name][0]: (answered[name], *series[name][1:]) for name in networks}
    race = []
    if modality == "dual":
        # Modello acerebellare: non c'è integrazione, risponde la rete più veloce.
        race = paired_race(results["auditory"]["response_times"], results["visual"]["response_times"])
        curves["Audiovisivo = modello a gara"] = (race, "-o", "#9a9a92", "#ffffff")
        rmi = race_model_inequality(answered["visual"], answered["auditory"], race, num_trials, num_trials, num_trials, step_ms=bin_ms)
        store.put_json("race_model.json", {"race_model": [{
            "population": "Reti uditiva e visiva",
            "note": "In questo modello la risposta AV è quella della rete più veloce, trial per trial: "
                    "la disuguaglianza non può essere violata.",
            "method": "rate_threshold_crossing",
            "n_V": len(answered["visual"]), "n_A": len(answered["auditory"]), "n_AV": len(race),
            "trials": {"V": num_trials, "A": num_trials, "AV": num_trials},
            "median_rt_ms": {"V": median_or_none(answered["visual"]), "A": median_or_none(answered["auditory"]),
                             "AV": median_or_none(race)},
            "percentile_levels": list(PAPER_PERCENTILES),
            "percentiles_ms": {"V": percentiles(answered["visual"]), "A": percentiles(answered["auditory"]),
                               "AV": percentiles(race)},
            "max_rmi_violation": round(rmi["max_violation"], 4),
            "p_value": rmi["p_value"],
            "has_facilitation": rmi["significant"],
        }]})
    plot_percentile_cdf(store, "exp_percentili_come_nel_paper.png",
                        "Tempi di risposta ai percentili 5-95 (reti corticali)", curves)

    fig, ax = plt.subplots(figsize=(8, 5))
    grid = np.arange(0.0, trial_ms + bin_ms, bin_ms)
    for label, (rts, _, color, _) in curves.items():
        ax.step(grid, ecdf(rts, grid, num_trials), where="post", lw=2, color=color,
                ls="--" if label == "Visivo" else "-", label=f"{label} ({len(rts)}/{num_trials} risposte corrette)")
    ax.set(title="Tempi di risposta", xlabel="Tempo dall'inizio del trial (ms)",
           ylabel="Frazione dei trial con risposta corretta", ylim=(0, 1.05), xlim=(0, min(trial_ms, 1000.0)))
    ax.legend(fontsize=9)
    ax.grid(alpha=0.3)
    store.put_figure("exp_tempi_di_risposta.png", fig)

    reported = race if modality == "dual" else answered[modality]
    first = results[networks[0]]
    correct = sum(row["is_correct"] for row in first["details"])
    missed = sum(1 for row in first["details"] if row["actual_winner"] == "none")
    metrics = {
        "experiment": "audiovisual_decision_making",
        "modality": modality,
        "num_trials": num_trials,
        "trials_active_A": sides.count("pop_A"),
        "trials_active_B": sides.count("pop_B"),
        "correct_trials": correct,
        "wrong_trials": num_trials - correct - missed,
        "missed_trials": missed,
        "response_times_ms": [round(rt, 1) for rt in reported],
        "median_response_time_ms": median_or_none(reported),
        "mean_response_time_ms": round(float(np.mean(reported)), 1) if reported else None,
        "rt_percentiles_ms": {name: percentiles(answered[name]) for name in networks} | ({"race_model": percentiles(race)} if race else {}),
        "median_by_network_ms": {name: median_or_none(answered[name]) for name in networks},
        "avg_rate_A_hz": first["mean_rate"]["pop_A"],
        "avg_rate_B_hz": first["mean_rate"]["pop_B"],
        "avg_rate_inh_hz": first["mean_rate"]["pop_inh"],
        "threshold_hz": float(cfg["threshold"]),
        "stimulus_latency_ms": {"auditory": float(cfg["auditory_latency_ms"]), "visual": float(cfg["visual_latency_ms"])},
        "network_order": par["order"],
        "n_neurons_per_excitatory_pop": 2 * par["order"],
    }
    store.put_json("experiment_metrics.json", metrics)
    store.close()
    progress_cb(100, "Completata")
    return metrics
