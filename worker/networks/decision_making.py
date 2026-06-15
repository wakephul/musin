"""
Audiovisual Decision-Making experiment — NEST 3.8 port.

Faithful re-implementation of the legacy NEST 2.18 pipeline
(`decision_making_nrp.py` + `main.py` + stimulus/analysis helpers) that powered
the audiovisual multisensory decision experiment:

  * Two competing excitatory populations (A, B) and a shared inhibitory pool,
    a Wang-style attractor decision network built on `iaf_psc_exp_multisynapse`
    with AMPA / NMDA / GABA / noise receptors and computed (PSP-normalized)
    weights.
  * Sensory evidence delivered as Poisson spike trains with a modality-specific
    first-spike latency: auditory = 150 ms, visual = 220 ms. The audiovisual
    condition merges both, producing earlier/denser evidence (race-model
    multisensory facilitation).
  * Trials of `trial_slot` ms are interleaved between side A and side B; the
    response time of a trial is the first moment the winning population's
    moving-average firing rate crosses `threshold`. The distribution of
    response times (CDF) is the headline result.

NEST 2.18 -> 3.8 API changes handled here:
  * `spike_detector` -> `spike_recorder`
  * `syn_spec={"model": ...}` -> `{"synapse_model": ...}`
  * recorder/`multimeter` no longer take withgid/withtime/to_file
  * `nest.ll_api.sli_func('LambertWm1', x)` -> `scipy.special.lambertw(x, k=-1)`
  * multi-seed RNG dict -> single `rng_seed`
  * `NodeCollection` indexing instead of GID tuples

Bit-exact reproduction across NEST 2.18 and 3.8 is not possible (different RNG
and kernel internals); the experiment design, parameters and statistics are
reproduced faithfully so the qualitative/quantitative result (multisensory
facilitation of response times) matches.
"""

import io
import gc
import json
import random
import logging

import numpy as np
from scipy.special import lambertw

logger = logging.getLogger(__name__)

# Modality first-spike latencies (ms) — from data/config/execution_types.json
MODALITY_LATENCY = {
    "auditory": 150.0,
    "visual": 220.0,
}

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
    "modality": "audiovisual",   # auditory | visual | audiovisual
    "rate": 30.0,                # Hz of the sensory Poisson drive
    "number_of_neurons": 80,     # sensory afferents per side
    "stimulus_window_ms": 600.0, # stimulus is active within [latency, window]
    "trial_slot_ms": 1000.0,     # length of one decision trial
    "num_trials": 12,            # legacy full run uses 60 (test_time 60000 ms)
    "threshold": 15.0,           # Hz; rate crossing that defines a response
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
# Stimulus generation
# ----------------------------------------------------------------------------

def _generate_single_trial_trains(nest, rate, latency, n_neurons, window_ms, seed):
    """Reproduce poisson_spikes_generator_parrot: a Poisson generator drives
    `n_neurons` parrot neurons over one trial window, returning one spike-time
    list per afferent (relative to trial start)."""
    nest.ResetKernel()
    nest.SetKernelStatus({"resolution": 0.1, "rng_seed": int(seed)})
    pg = nest.Create("poisson_generator", params={"rate": float(rate), "start": float(latency), "stop": float(window_ms)})
    parrots = nest.Create("parrot_neuron", int(n_neurons))
    rec = nest.Create("spike_recorder")
    nest.Connect(pg, parrots, "all_to_all")
    nest.Connect(parrots, rec, "all_to_all")
    nest.Simulate(float(window_ms) + 1.0)

    events = nest.GetStatus(rec, "events")[0]
    first_gid = parrots[0].global_id
    trains = [[] for _ in range(int(n_neurons))]
    for sender, t in zip(events["senders"], events["times"]):
        idx = int(sender) - first_gid
        if 0 <= idx < n_neurons:
            trains[idx].append(round(float(t), 1))
    return trains


def _build_side_stimulus(nest, exp, latency_a, latency_b, seed):
    """Build per-afferent single-trial trains for one side, optionally merging
    two modalities (audiovisual). latency_b is None for unimodal."""
    trains = _generate_single_trial_trains(
        nest, exp["rate"], latency_a, exp["number_of_neurons"],
        exp["stimulus_window_ms"], seed,
    )
    if latency_b is not None:
        trains_2 = _generate_single_trial_trains(
            nest, exp["rate"], latency_b, exp["number_of_neurons"],
            exp["stimulus_window_ms"], seed + 7,
        )
        merged = []
        for ta, tb in zip(trains, trains_2):
            merged.append(sorted(set([round(x, 1) for x in ta] + [round(x, 1) for x in tb])))
        trains = merged
    return trains


def _tile_trains_across_trials(single_trains, active_trials, trial_slot):
    """Tile one-trial afferent trains across the trials where this side is
    active, shifting each by the trial's start time."""
    tiled = [[] for _ in single_trains]
    for trial_idx, is_active in enumerate(active_trials):
        if not is_active:
            continue
        offset = trial_idx * trial_slot
        for n, train in enumerate(single_trains):
            tiled[n].extend([round(t + offset, 1) for t in train])
    for n in range(len(tiled)):
        tiled[n] = sorted(set(tiled[n]))
    return tiled


# ----------------------------------------------------------------------------
# Network
# ----------------------------------------------------------------------------

def _build_network(nest, par, trains_a, trains_b):
    """Build the Wang two-population attractor and attach the tiled stimuli.
    Returns recorders and monitored sub-populations for A, B and inhibitory."""
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

    # Sensory stimulus: one spike_generator per afferent train -> all_to_all.
    def make_generators(trains):
        nodes = nest.Create("spike_generator", len(trains))
        for i, train in enumerate(trains):
            if train:
                nest.SetStatus(nodes[i], {"spike_times": list(train)})
        return nodes

    PG_input_A = make_generators(trains_a)
    PG_input_B = make_generators(trains_b)

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

    # Set noise rates (single sample, legacy behavior)
    rng = np.random.default_rng(int(par.get("_np_seed", 1234)))
    nest.SetStatus(PG_noise_A, {"rate": float(rng.normal(p_rate_ex, p_rate_ex / par["std_noise"]))})
    nest.SetStatus(PG_noise_B, {"rate": float(rng.normal(p_rate_ex, p_rate_ex / par["std_noise"]))})
    nest.SetStatus(PG_noise_inh, {"rate": float(rng.normal(p_rate_in, p_rate_in / par["std_noise"]))})

    # Recorders on a monitored subset (legacy rec_pop = 1.0 -> all)
    def monitor(pop):
        k = max(1, int(par["rec_pop"] * len(pop)))
        idx = sorted(random.sample(range(len(pop)), k))
        sub = pop[idx]
        rec = nest.Create("spike_recorder")
        nest.Connect(sub, rec)
        return rec, len(sub)

    rec_A, n_A = monitor(pop_A)
    rec_B, n_B = monitor(pop_B)
    rec_inh, n_inh = monitor(pop_inh)

    return {
        "rec_A": rec_A, "rec_B": rec_B, "rec_inh": rec_inh,
        "n_A": n_A, "n_B": n_B, "n_inh": n_inh,
    }


# ----------------------------------------------------------------------------
# Analysis
# ----------------------------------------------------------------------------

def _binned_rate(times, n_neurons, bin_size, total_ms):
    """Population firing rate (Hz) per bin."""
    if n_neurons <= 0:
        n_neurons = 1
    edges = np.arange(0.0, total_ms + bin_size, bin_size)
    counts, _ = np.histogram(np.asarray(times, dtype=float), bins=edges)
    rate = counts * 1000.0 / (bin_size * n_neurons)
    return edges[:-1], rate


def _moving_average(values, window=10):
    if len(values) == 0:
        return values
    pad = window // 2
    padded = np.concatenate([np.zeros(pad), values, np.zeros(pad)])
    out = np.convolve(padded, np.ones(window) / window, mode="same")
    return out[pad:pad + len(values)]


def _response_times(rate_curve, bin_centers, active_trials, trial_slot, threshold):
    """First within-trial time (ms) the rate crosses threshold, for trials
    where this side is active. Returns list of latencies relative to trial start."""
    rts = []
    for trial_idx, is_active in enumerate(active_trials):
        if not is_active:
            continue
        t0 = trial_idx * trial_slot
        t1 = t0 + trial_slot
        mask = (bin_centers >= t0) & (bin_centers < t1)
        seg_rate = rate_curve[mask]
        seg_time = bin_centers[mask] - t0
        crossings = np.where(seg_rate >= threshold)[0]
        if len(crossings):
            rts.append(float(seg_time[crossings[0]]))
    return rts


def _cdf(data, n_bins=10):
    if len(data) == 0:
        return np.array([]), np.array([])
    counts, edges = np.histogram(data, bins=n_bins)
    pdf = counts / max(1, counts.sum())
    return edges[1:], np.cumsum(pdf)


# ----------------------------------------------------------------------------
# Orchestrator
# ----------------------------------------------------------------------------

def run_decision_making_experiment(task, simulation_id, exp_params, minio_service, progress_cb=None):
    """Run the full audiovisual decision-making experiment and upload artifacts.

    Returns a dict with the experiment metrics. Plots are uploaded to
    `results/<owner>/sim_<id>/` so the existing results endpoint serves them.
    """
    import nest
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cfg = dict(DEFAULT_EXPERIMENT)
    cfg.update(exp_params.get("decision_making", {}) or {})

    par = dict(DEFAULT_NETWORK_PARAMS)
    par.update(exp_params.get("network_overrides", {}) or {})
    par["order"] = int(cfg["order"])
    par["rec_pop"] = par.get("rec_pop", 1.0)
    par["_np_seed"] = int(cfg["seed"])

    modality = cfg["modality"]
    trial_slot = float(cfg["trial_slot_ms"])
    num_trials = int(cfg["num_trials"])
    bin_size = float(cfg["bin_size_ms"])
    threshold = float(cfg["threshold"])
    total_ms = trial_slot * num_trials

    # Modality latencies
    if modality == "auditory":
        lat_a = lat_b = MODALITY_LATENCY["auditory"]
        merge_second = None
    elif modality == "visual":
        lat_a = lat_b = MODALITY_LATENCY["visual"]
        merge_second = None
    else:  # audiovisual: merge auditory + visual evidence
        lat_a = MODALITY_LATENCY["auditory"]
        merge_second = MODALITY_LATENCY["visual"]

    random.seed(int(cfg["seed"]))

    # 1) Single-trial sensory trains for side A and side B
    if progress_cb:
        progress_cb(5, "Generating sensory stimuli")
    trains_A_single = _build_side_stimulus(nest, cfg, lat_a, merge_second, seed=int(cfg["seed"]))
    trains_B_single = _build_side_stimulus(nest, cfg, lat_a, merge_second, seed=int(cfg["seed"]) + 101)

    # 2) Assign trials to sides (balanced, shuffled — legacy seed 1234)
    side_flags = [bool(i % 2) for i in range(num_trials)]
    random.seed(1234)
    random.shuffle(side_flags)
    active_A = [not f for f in side_flags]   # A active on even-side trials
    active_B = list(side_flags)

    trains_A = _tile_trains_across_trials(trains_A_single, active_A, trial_slot)
    trains_B = _tile_trains_across_trials(trains_B_single, active_B, trial_slot)

    # 3) Build network
    if progress_cb:
        progress_cb(20, "Building decision network")
    nest.ResetKernel()
    nest.SetKernelStatus({
        "resolution": float(par["dt"]),
        "rng_seed": int(cfg["seed"]),
        "local_num_threads": 6,
        "print_time": False,
    })
    mon = _build_network(nest, par, trains_A, trains_B)

    # 4) Simulate in chunks with progress + GC
    if progress_cb:
        progress_cb(30, "Simulating")
    chunk = 500.0
    done = 0.0
    while done < total_ms:
        step = min(chunk, total_ms - done)
        nest.Simulate(step)
        done += step
        if progress_cb:
            progress_cb(30 + int(60 * done / total_ms), "Simulating")
        gc.collect()

    # 5) Collect spikes
    ev_A = nest.GetStatus(mon["rec_A"], "events")[0]
    ev_B = nest.GetStatus(mon["rec_B"], "events")[0]
    ev_inh = nest.GetStatus(mon["rec_inh"], "events")[0]
    times_A, sen_A = list(ev_A["times"]), list(ev_A["senders"])
    times_B, sen_B = list(ev_B["times"]), list(ev_B["senders"])
    times_inh, sen_inh = list(ev_inh["times"]), list(ev_inh["senders"])

    if progress_cb:
        progress_cb(92, "Analyzing & plotting")

    # 6) Rates + response times
    centers_A, rate_A = _binned_rate(times_A, mon["n_A"], bin_size, total_ms)
    centers_B, rate_B = _binned_rate(times_B, mon["n_B"], bin_size, total_ms)
    ma_A = _moving_average(rate_A)
    ma_B = _moving_average(rate_B)

    rt_A = _response_times(ma_A, centers_A, active_A, trial_slot, threshold)
    rt_B = _response_times(ma_B, centers_B, active_B, trial_slot, threshold)
    response_times = rt_A + rt_B

    avg_rate_A = float(len(times_A) * 1000.0 / total_ms / max(1, mon["n_A"]))
    avg_rate_B = float(len(times_B) * 1000.0 / total_ms / max(1, mon["n_B"]))
    avg_rate_inh = float(len(times_inh) * 1000.0 / total_ms / max(1, mon["n_inh"]))

    # 7) Plots -> MinIO (names chosen so the results endpoint discovers them)
    import zipfile
    base_path = f"results/{simulation_id['owner_id']}/sim_{simulation_id['sim_id']}"
    zip_buf = io.BytesIO()
    zf = zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED)

    def upload_png(fig, name):
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
        plt.close(fig)
        data = buf.getvalue()
        minio_service.upload_file(io.BytesIO(data), len(data), f"{base_path}/{name}", "image/png")
        zf.writestr(name, data)
        del buf

    # Per-population rasters + PSTH (named to match topology pop ids pop_A/pop_B/pop_inh)
    for pop_id, times, senders in (
        ("pop_A", times_A, sen_A), ("pop_B", times_B, sen_B), ("pop_inh", times_inh, sen_inh),
    ):
        fig = plt.figure(figsize=(9, 4))
        if times:
            plt.scatter(times, senders, s=1.5, color="#2563eb" if pop_id != "pop_B" else "#dc2626")
        plt.title(f"Raster — {pop_id}")
        plt.xlabel("Time (ms)"); plt.ylabel("Neuron")
        upload_png(fig, f"{pop_id}_raster.png")

        fig = plt.figure(figsize=(9, 4))
        if times:
            plt.hist(times, bins=80, color="#7c3aed", alpha=0.75)
        plt.title(f"Spike histogram — {pop_id}")
        plt.xlabel("Time (ms)"); plt.ylabel("Spikes")
        upload_png(fig, f"{pop_id}_histogram.png")
        gc.collect()

    # A vs B competition (population rate over time)
    fig = plt.figure(figsize=(11, 4))
    plt.plot(centers_A, ma_A, color="#2563eb", lw=1.5, label="Pop A (rate)")
    plt.plot(centers_B, ma_B, color="#dc2626", lw=1.5, label="Pop B (rate)")
    plt.axhline(threshold, color="black", ls="--", lw=1, alpha=0.6, label=f"Threshold ({threshold:g} Hz)")
    for i in range(num_trials):
        plt.axvline(i * trial_slot, color="#cbd5e1", lw=0.5)
    plt.title("Decision competition — Pop A vs Pop B")
    plt.xlabel("Time (ms)"); plt.ylabel("Firing rate (Hz)")
    plt.legend(fontsize=9)
    upload_png(fig, "exp_A_vs_B_competition.png")

    # Response-time CDF
    x_cdf, y_cdf = _cdf(response_times, n_bins=10)
    fig = plt.figure(figsize=(8, 5))
    if len(x_cdf):
        plt.plot(x_cdf, y_cdf, "--o", color="#16a34a", label=f"{modality} (n={len(response_times)})")
    plt.xlim(0, max(600.0, cfg["stimulus_window_ms"]))
    plt.ylim(0, 1.05)
    plt.title("Response-time CDF")
    plt.xlabel("Response time (ms)"); plt.ylabel("Cumulative probability")
    plt.legend(fontsize=9); plt.grid(alpha=0.3)
    upload_png(fig, "exp_response_time_CDF.png")

    # 8) Metrics JSON
    metrics = {
        "experiment": "audiovisual_decision_making",
        "modality": modality,
        "num_trials": num_trials,
        "trials_active_A": int(sum(active_A)),
        "trials_active_B": int(sum(active_B)),
        "response_times_ms": [round(x, 1) for x in response_times],
        "median_response_time_ms": round(float(np.median(response_times)), 1) if response_times else None,
        "mean_response_time_ms": round(float(np.mean(response_times)), 1) if response_times else None,
        "avg_rate_A_hz": round(avg_rate_A, 2),
        "avg_rate_B_hz": round(avg_rate_B, 2),
        "avg_rate_inh_hz": round(avg_rate_inh, 2),
        "threshold_hz": threshold,
        "network_order": par["order"],
        "n_neurons_per_excitatory_pop": 2 * par["order"],
    }
    mbytes = json.dumps(metrics, indent=2).encode("utf-8")
    minio_service.upload_file(io.BytesIO(mbytes), len(mbytes), f"{base_path}/experiment_metrics.json", "application/json")
    zf.writestr("experiment_metrics.json", mbytes)

    # Raw spikes (keeps the detail page "Raw Spikes" download working)
    spikes_payload = {
        "metadata": {"simulation_id": simulation_id["sim_id"], "total_duration_ms": total_ms, "experiment": "audiovisual_decision_making"},
        "spikes": {
            "pop_A": {"senders": [int(s) for s in sen_A], "times": [float(t) for t in times_A]},
            "pop_B": {"senders": [int(s) for s in sen_B], "times": [float(t) for t in times_B]},
            "pop_inh": {"senders": [int(s) for s in sen_inh], "times": [float(t) for t in times_inh]},
        },
    }
    sbytes = json.dumps(spikes_payload).encode("utf-8")
    minio_service.upload_file(io.BytesIO(sbytes), len(sbytes), f"{base_path}/spikes.json", "application/json")
    del sbytes

    # Finalize ZIP of all artifacts
    zf.close()
    zbytes = zip_buf.getvalue()
    minio_service.upload_file(io.BytesIO(zbytes), len(zbytes), f"{base_path}/graphs.zip", "application/zip")
    del zbytes

    if progress_cb:
        progress_cb(100, "Done")
    gc.collect()
    return metrics
