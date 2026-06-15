"""
Cerebellum MSI Race Model — Train + Test builtin experiment.

Models: the CerebNEST eglif pacemakers are overridden to iaf_cond_exp (PC, DCN)
and parrot_neuron (IO) so populations have a 0 Hz baseline and fire ONLY with
synaptic drive — required for clean rate-threshold reaction times.

Phase 1 (Training, manual plasticity):
  CS → GR → PC_A; US_A → IO_A (climbing-fiber teaching signal). NEST 3.8 lacks
  volume_transmitter_alberto, so stdp_synapse_sinexp is replaced by manual
  CF-gated LTD: GR→PC_A weights are depressed each trial → PC_A is silenced →
  it stops inhibiting DCN_A (cerebellar disinhibition). GR→PC_B is NOT taught,
  so PC_B stays active and keeps DCN_B silenced.

Phase 2 (Test, plasticity OFF):
  VIS/AUD → GR and VIS/AUD → DCN_A. Trial mix V / A / AV / CATCH (≈30/30/30/10%).
  - PC→DCN is INHIBITORY via a NEGATIVE weight (iaf_cond_exp has no inhibitory
    receptor port; the weight SIGN selects the inhibitory conductance). This is
    what keeps DCN_B at 0 → the DCN_A−DCN_B decision is ~100% accurate.
  - AV is COACTIVATION: the VIS and AUD spike_generators fire concurrently as two
    independent Poisson trains (NOT merged); their conductances SUM at DCN_A
    (40 vs 20 afferents). The MF→DCN_A weight is tuned so a single modality is
    near-threshold/slow while AV crosses the 15 Hz threshold fast.
  - Latencies (aud 180 ms, vis 220 ms — Cavadini et al. 2025); the small
    gap is essential so AV beats A (see body comment).
  Reaction time is a RACE across populations (earliest 15 Hz crossing of any DCN);
  CDFs feed the Miller (1982) Race Model Inequality → AV < A < V with facilitation.
"""
import gc
import io
import json
import random
import logging
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import zipfile

logger = logging.getLogger(__name__)

CUSTOM_NESTML_MODELS = {
    "eglif_cond_alpha_multisyn", "eglif_pc_nestml", "eglif_mli",
    "eglif_io_nestml", "eglif_dcnp",
}

# Override eglif pacemaker models → iaf_cond_exp (matching cerebellum_simple.py reference).
# eglif_pc_nestml fires tonically at ~40 Hz regardless of input → PC_A never silenced after LTD.
# eglif_dcnp fires at ~5 Hz baseline → false threshold crossings before stimulus arrives.
# iaf_cond_exp has no tonic firing: fires ONLY with synaptic drive → 0 Hz baseline → correct RTs.
# eglif_io_nestml → parrot_neuron so IO is silent during test (no training Poisson input).
_IAF_PC_PARAMS = {"t_ref": 2.0, "C_m": 400.0, "V_th": -52.0, "V_reset": -70.0,
                  "E_L": -70.0, "g_L": 16.0, "tau_syn_ex": 0.5, "tau_syn_in": 1.6}
_IAF_DCN_PARAMS = {"t_ref": 1.0, "C_m": 2.0, "V_th": -40.0, "V_reset": -70.0,
                   "E_L": -70.0, "g_L": 0.2, "tau_syn_ex": 0.5, "tau_syn_in": 10.0}
_MODEL_OVERRIDE = {
    "eglif_pc_nestml": ("iaf_cond_exp", _IAF_PC_PARAMS),
    "eglif_dcnp":      ("iaf_cond_exp", _IAF_DCN_PARAMS),
    "eglif_io_nestml": ("parrot_neuron", {}),
}
NEST_CONN_KEYS = {"indegree", "outdegree", "p", "mask", "kernel", "allow_autapses", "allow_multapses"}


def _sanitize(params: dict) -> dict:
    import nest
    out = {}
    for k, v in params.items():
        if isinstance(v, dict) and "distribution" in v:
            dist = v["distribution"]
            if dist == "uniform":
                out[k] = nest.random.uniform(min=float(v.get("low", 0.0)), max=float(v.get("high", 1.0)))
            elif dist == "normal":
                out[k] = nest.random.normal(mean=float(v.get("mean", 0.0)), std=float(v.get("std", 1.0)))
            continue
        float_keys = {"start", "stop", "rate", "weight", "delay", "A_plus", "A_minus",
                      "V_m", "V_th", "E_L", "C_m", "tau_m", "t_ref"}
        if k in float_keys and isinstance(v, (int, float)):
            out[k] = float(v)
        else:
            out[k] = v
    return out


def _poisson_in_window(rate: float, n_sources: int, t_start: float, t_end: float) -> list:
    duration = t_end - t_start
    if rate <= 0 or duration <= 0:
        return [[] for _ in range(n_sources)]
    mean_isi = 1000.0 / rate
    trains = []
    for _ in range(n_sources):
        t, spikes = 0.0, []
        while True:
            t += random.expovariate(1.0 / mean_isi)
            if t >= duration:
                break
            r = round(t + t_start, 1)
            if r > t_start:
                spikes.append(r)
        trains.append(sorted(set(spikes)))
    return trains


def _make_trial_windows(n_trials: int, trial_dur: float, stim_dur: float,
                        iti_range: list, t_offset: float = 0.0):
    windows = []
    t = t_offset
    for _ in range(n_trials):
        # Quantize ITI to the 0.1 ms kernel grid so every Simulate() call
        # stays a multiple of the resolution.
        iti = round(random.uniform(float(iti_range[0]), float(iti_range[1])), 1)
        windows.append({
            "stim_start": round(t, 1),
            "stim_end":   round(t + stim_dur, 1),
            "trial_end":  round(t + trial_dur, 1),
            "iti":        iti,
        })
        t = round(t + trial_dur + iti, 1)
    return windows, t


def _connect(src_nodes, tgt_nodes, rule: str, raw_params: dict, synapse_model: str):
    import nest
    conn_spec = {"rule": rule}
    syn_spec = dict(raw_params)
    for k in list(syn_spec.keys()):
        if k in NEST_CONN_KEYS:
            val = syn_spec.pop(k)
            conn_spec[k] = int(float(val)) if k in ("indegree", "outdegree") else val
    syn_spec["synapse_model"] = synapse_model
    try:
        tgt_model = nest.GetStatus(tgt_nodes)[0]["model"]
        avail = nest.GetDefaults(tgt_model).get("receptor_types", {})
    except Exception:
        avail = {}
    if avail and "receptor_type" not in syn_spec:
        syn_spec["receptor_type"] = min(avail.values())
    elif "receptor_type" in syn_spec and avail:
        if int(syn_spec["receptor_type"]) not in set(avail.values()):
            del syn_spec["receptor_type"]
    try:
        nest.Connect(src_nodes, tgt_nodes, conn_spec=conn_spec, syn_spec=syn_spec)
    except Exception as e:
        if "UnknownReceptorType" in str(e) and "receptor_type" in syn_spec:
            del syn_spec["receptor_type"]
            nest.Connect(src_nodes, tgt_nodes, conn_spec=conn_spec, syn_spec=syn_spec)
        else:
            raise


def run_cerebellum_msi_race(task, sim_info, exp_params, minio_service, progress_cb):
    import nest

    owner_id = sim_info["owner_id"]
    sim_id   = sim_info["sim_id"]
    net_def  = sim_info["network_definition"]
    base_path = f"results/{owner_id}/sim_{sim_id}"

    seed = int(exp_params.get("seed", 2016))
    random.seed(seed)
    np.random.seed(seed)

    train_cfg  = exp_params.get("train", {})
    test_cfg   = exp_params.get("test", {})
    resolution = float(exp_params.get("resolution", 0.1))

    n_train    = int(train_cfg.get("n_trials", 50))
    train_dur  = float(train_cfg.get("trial_duration_ms", 1000.0))
    train_stim = float(train_cfg.get("stimulus_duration_ms", 300.0))
    train_iti  = train_cfg.get("iti_range_ms", [500, 1000])
    cs_rate    = float(train_cfg.get("cs_rate", 20.0))
    cs_n       = int(train_cfg.get("cs_n_sources", 20))
    us_rate    = float(train_cfg.get("us_rate", 8.5))
    us_n       = int(train_cfg.get("us_n_sources", 10))

    n_test     = int(test_cfg.get("n_trials", 100))
    test_dur   = float(test_cfg.get("trial_duration_ms", 1500.0))
    test_stim  = float(test_cfg.get("stimulus_duration_ms", 200.0))
    test_iti   = test_cfg.get("iti_range_ms", [1000, 2500])
    vis_rate   = float(test_cfg.get("vis_rate", 25.0))
    aud_rate   = float(test_cfg.get("aud_rate", 25.0))
    test_n_src = int(test_cfg.get("n_sources", 20))
    # First-spike latencies (Cavadini et al. 2025): auditory 180 ms, visual 220 ms.
    # The SMALL gap is essential: if auditory arrives far earlier (e.g. 150 vs 250)
    # the auditory channel alone crosses threshold before the visual component of
    # an AV trial ever arrives, so AV cannot beat A. With the close latencies the
    # doubled AV drive wins → AV < A < V (multisensory facilitation).
    aud_latency = float(test_cfg.get("aud_latency_ms", 180.0))
    vis_latency = float(test_cfg.get("vis_latency_ms", 220.0))

    # Kernel
    nest.ResetKernel()
    nest.SetKernelStatus({
        "local_num_threads": 6,
        "resolution": resolution,
        "dict_miss_is_error": False,
        "print_time": True,
        "rng_seed": seed,
    })
    for mod in ("cerebellar_module", "cerebmodule"):
        try:
            nest.Install(mod)
            logger.info(f"NEST module '{mod}' loaded.")
            break
        except Exception:
            pass

    # Trial windows
    train_wins, train_end = _make_trial_windows(n_train, train_dur, train_stim, train_iti, t_offset=0.0)

    test_pool = [
        {"devices": ["VIS"],        "weight": 0.3, "label": "V"},
        {"devices": ["AUD"],        "weight": 0.3, "label": "A"},
        {"devices": ["VIS", "AUD"], "weight": 0.3, "label": "AV"},
        {"devices": [],             "weight": 0.1, "label": "CATCH"},
    ]
    test_sequence, test_labels = [], []
    for _ in range(n_test):
        chosen = random.choices(test_pool, weights=[p["weight"] for p in test_pool], k=1)[0]
        test_sequence.append(chosen["devices"])
        test_labels.append(chosen["label"])

    test_wins, total_end = _make_trial_windows(n_test, test_dur, test_stim, test_iti, t_offset=train_end)
    total_time = total_end

    # Build network populations
    topology = net_def.get("topology", {})
    pops_data = topology.get("populations", [])
    proj_data = topology.get("projections", [])

    pop_map, spike_recs = {}, {}
    for pop in pops_data:
        pid   = pop["id"]
        model = pop["neuron_model"]
        size  = int(pop["size"])
        if model in _MODEL_OVERRIDE:
            model, fparams = _MODEL_OVERRIDE[model]
        else:
            raw = _sanitize(pop.get("params", {}))
            if model in CUSTOM_NESTML_MODELS:
                fparams = raw
            else:
                try:
                    valid_keys = nest.GetDefaults(model).keys()
                    fparams = {k: v for k, v in raw.items() if k in valid_keys}
                except Exception:
                    fparams = raw
        pop_map[pid] = nest.Create(model, size, params=fparams)
        if "generator" not in model and "stimulus" not in model:
            rec = nest.Create("spike_recorder")
            nest.Connect(pop_map[pid][:min(size, 250)], rec)
            spike_recs[pid] = rec

    # GR→PC and PC→DCN are overridden below with correct params regardless of
    # what the stored network definition says (handles old DB records with
    # stdp_synapse_sinexp / wrong receptor_type / wrong weight sign).
    _OVERRIDE = {("GR","PC_A"), ("GR","PC_B"), ("PC_A","DCN_A"), ("PC_B","DCN_B")}

    for proj in proj_data:
        src, tgt = proj["source"], proj["target"]
        if src not in pop_map or tgt not in pop_map:
            continue
        if (src, tgt) in _OVERRIDE:
            continue
        _connect(pop_map[src], pop_map[tgt],
                 proj.get("rule", "all_to_all"),
                 _sanitize(proj.get("params", {})),
                 proj.get("synapse_model", "static_synapse"))

    # GR→PC_A and GR→PC_B: static_synapse (NEST 3.8 has no volume_transmitter_alberto;
    # manual CF-gated LTD replaces stdp_synapse_sinexp — same as cerebellum_conditioning.py).
    Init_PFPC = float(next(
        (json.loads(p["biological_params"]).get("Init_PFPC", 4.0)
         for p in [net_def] if isinstance(p.get("biological_params"), str)),
        4.0))
    for _pc in ("PC_A", "PC_B"):
        if "GR" not in pop_map or _pc not in pop_map:
            continue
        _ideg = int(float(next(
            (p.get("params", {}).get("indegree", 160)
             for p in proj_data if p["source"] == "GR" and p["target"] == _pc),
            160)))
        _connect(pop_map["GR"], pop_map[_pc], "fixed_indegree",
                 {"indegree": _ideg, "weight": Init_PFPC, "receptor_type": 1},
                 "static_synapse")

    # PC→DCN: INHIBITORY. The DCN model is overridden to iaf_cond_exp (above),
    # which has NO receptor_type=2 inhibitory port — so passing receptor_type=2
    # was silently dropped and the synapse defaulted to EXCITATORY, making the
    # active PC *excite* its DCN (DCN_B fired ~as much as DCN_A → ~50% accuracy).
    # iaf_cond_exp selects the inhibitory conductance (E_in≈-85 mV, tau_syn_in=10 ms)
    # by the SIGN of the weight: a NEGATIVE weight is inhibitory. So PC_B (active)
    # now silences DCN_B, while PC_A (silenced by LTD) leaves DCN_A free to respond
    # to the sensory drive → DCN_A − DCN_B is strongly positive → ~100% accuracy.
    for _pc, _dcn in (("PC_A", "DCN_A"), ("PC_B", "DCN_B")):
        if _pc not in pop_map or _dcn not in pop_map:
            continue
        _odeg = int(float(next(
            (p.get("params", {}).get("outdegree", 1)
             for p in proj_data if p["source"] == _pc and p["target"] == _dcn),
            1)))
        _connect(pop_map[_pc], pop_map[_dcn], "fixed_outdegree",
                 {"outdegree": _odeg, "weight": -20.0},
                 "static_synapse")

    pfpc_a_conns = None
    if "GR" in pop_map and "PC_A" in pop_map:
        pfpc_a_conns = nest.GetConnections(pop_map["GR"], pop_map["PC_A"])
        logger.info(f"MSI Race: cached {len(pfpc_a_conns)} GR→PC_A connections for LTD")

    W_MIN = 0.0
    LTD_RATE = 1.5  # depresses all GR→PC_A to 0 in 3 trials

    # Global LTD: depress ALL GR→PC_A weights each trial regardless of which GR
    # neurons were active. CS (training) and VIS/AUD (test) connect to different
    # GR subpopulations, so synapse-specific LTD would leave test-active GR→PC_A
    # weights at Init_PFPC → PC_A would still inhibit DCN_A during test. Global
    # LTD ensures PC_A is suppressed by any sensory input after training.
    def _apply_ltd_msi():
        if pfpc_a_conns is None or len(pfpc_a_conns) == 0:
            return
        weights = np.asarray(nest.GetStatus(pfpc_a_conns, "weight"), dtype=float)
        new_w = np.maximum(W_MIN, weights - LTD_RATE)
        nest.SetStatus(pfpc_a_conns, "weight", new_w.tolist())

    # Training generators: CS→GR, US_A→IO_A
    def _build_gens(rate, n_src, windows):
        all_trains = [[] for _ in range(n_src)]
        for win in windows:
            for i, t in enumerate(_poisson_in_window(rate, n_src, win["stim_start"], win["stim_end"])):
                all_trains[i].extend(t)
        nodes = nest.Create("spike_generator", n_src)
        for i, node in enumerate(nodes):
            spikes = sorted(all_trains[i])
            if spikes:
                nest.SetStatus(node, {"spike_times": spikes})
        return nodes

    cs_nodes  = _build_gens(cs_rate, cs_n, train_wins)
    us_a_nodes = _build_gens(us_rate, us_n, train_wins)

    if "GR" in pop_map:
        _connect(cs_nodes, pop_map["GR"], "fixed_indegree",
                 {"indegree": 1, "weight": 1.2, "delay": 1.0}, "static_synapse")
    if "IO_A" in pop_map:
        _connect(us_a_nodes, pop_map["IO_A"], "all_to_all",
                 {"weight": 1.0, "delay": 1.0, "receptor_type": 1}, "static_synapse")

    # Test generators: VIS, AUD
    def _build_test_gens(rate, n_src, active_wins, latency=0.0):
        all_trains = [[] for _ in range(n_src)]
        for t_start, t_end in active_wins:
            # Onset delayed by the modality latency; the drive then lasts until
            # stim_end. If the latency would not fit inside the stimulus window
            # (short-window presets), it is skipped so the trial still has input.
            s = t_start + latency if latency < (t_end - t_start) else t_start
            for i, t in enumerate(_poisson_in_window(rate, n_src, s, t_end)):
                all_trains[i].extend(t)
        nodes = nest.Create("spike_generator", n_src)
        for i, node in enumerate(nodes):
            spikes = sorted(all_trains[i])
            if spikes:
                nest.SetStatus(node, {"spike_times": spikes})
        return nodes

    vis_wins_active = [(test_wins[i]["stim_start"], test_wins[i]["stim_end"])
                       for i in range(n_test) if "VIS" in test_sequence[i]]
    aud_wins_active = [(test_wins[i]["stim_start"], test_wins[i]["stim_end"])
                       for i in range(n_test) if "AUD" in test_sequence[i]]

    vis_nodes = _build_test_gens(vis_rate, test_n_src, vis_wins_active, vis_latency)
    aud_nodes = _build_test_gens(aud_rate, test_n_src, aud_wins_active, aud_latency)

    if "GR" in pop_map:
        # indegree=4 matches old cerebellum_simple.py (input_dendrites_gr=4).
        # With 80 sources at 30 Hz each GR gets 4×30=120 Hz equivalent input →
        # GR fires reliably (~10-20 Hz) → GR→PC_B (weight=4.0) gets real boost →
        # PC_B fires much faster than PC_A (GR→PC_A=0 after global LTD) →
        # DCN_B strongly suppressed → genuine DCN_A − DCN_B differential.
        _GR_INDEGREE = 4
        _GR_WEIGHT   = 2.0
        _connect(vis_nodes, pop_map["GR"], "fixed_indegree",
                 {"indegree": _GR_INDEGREE, "weight": _GR_WEIGHT, "delay": 1.0}, "static_synapse")
        _connect(aud_nodes, pop_map["GR"], "fixed_indegree",
                 {"indegree": _GR_INDEGREE, "weight": _GR_WEIGHT, "delay": 1.0}, "static_synapse")
    # MF→DCN_A: this is the COACTIVATION drive that produces the multisensory
    # facilitation (AV CDF leftmost). The weight is tuned so a SINGLE modality
    # (test_n_src afferents) is only weakly/near-threshold — it crosses the 15 Hz
    # rate threshold slowly or not at all — while the COMBINED AV drive (2×
    # afferents) is firmly suprathreshold and crosses fast. With iaf_cond_exp DCN
    # (V_th=-40, g_L=0.2, tau_syn_ex=0.5 ms, E_ex=0) the steady potential is
    # V_eq = g_L·E_L/(g_L+g_syn), g_syn = N·rate·w·tau_syn[s]; the half/full-drive
    # split straddles V_th so only the combined stimulus reliably and quickly fires
    # DCN_A. Exposed as a test param so it can be tuned per preset.
    _mf_w_lo = float(test_cfg.get("mf_dcn_weight_low",  0.34))
    _mf_w_hi = float(test_cfg.get("mf_dcn_weight_high", 0.40))
    if "DCN_A" in pop_map:
        _connect(vis_nodes, pop_map["DCN_A"], "all_to_all",
                 {"weight": nest.random.uniform(min=_mf_w_lo, max=_mf_w_hi), "delay": 20.0, "receptor_type": 1}, "static_synapse")
        _connect(aud_nodes, pop_map["DCN_A"], "all_to_all",
                 {"weight": nest.random.uniform(min=_mf_w_lo, max=_mf_w_hi), "delay": 20.0, "receptor_type": 1}, "static_synapse")

    # Simulate
    simulated = 0.0
    CHUNK = 500.0

    # Decimal places of the resolution (0.1 -> 1) so Simulate() args land
    # exactly on the grid and avoid float artefacts (e.g. 300.00000000006).
    _ndec = max(0, len(str(resolution).split(".")[1])) if "." in str(resolution) else 0

    def _run(duration: float, phase: str):
        nonlocal simulated
        rem = round(duration, _ndec)
        while rem > 1e-9:
            c = round(min(CHUNK, rem), _ndec)
            nest.Simulate(c)
            rem = round(rem - c, _ndec)
            simulated += c
            progress_cb(int(min(simulated / total_time, 1.0) * 100), phase)
            gc.collect()

    progress_cb(0, "INIT")

    # Training phase
    logger.info(f"MSI Race: training {n_train} trials (0 → {train_end:.0f} ms)")
    for i, win in enumerate(train_wins):
        _run(win["stim_end"] - win["stim_start"], f"TRAIN {i+1}")
        _run(win["trial_end"] - win["stim_end"],  f"TRAIN {i+1} resp")
        _run(win["iti"],                           f"TRAIN {i+1} ITI")
        _apply_ltd_msi()

    if pfpc_a_conns is not None and len(pfpc_a_conns) > 0:
        w_post = np.asarray(nest.GetStatus(pfpc_a_conns, "weight"), dtype=float)
        logger.info(f"MSI Race: GR→PC_A weights after training — mean={w_post.mean():.4f} max={w_post.max():.4f}")

    # Disable plasticity
    logger.info("MSI Race: disabling STDP for test phase")
    for sm in ("stdp_synapse_sinexp", "stdp_synapse_alpha", "stdp_synapse"):
        try:
            conns = nest.GetConnections(synapse_model=sm)
            if len(conns) > 0:
                defaults = nest.GetDefaults(sm)
                zeros = {p: 0.0 for p in ["A_plus", "A_minus", "lambda", "alpha",
                                           "mu_plus", "mu_minus"] if p in defaults}
                if zeros:
                    nest.SetStatus(conns, zeros)
        except Exception:
            pass

    # Test phase
    logger.info(f"MSI Race: test {n_test} trials ({train_end:.0f} → {total_end:.0f} ms)")
    for i, win in enumerate(test_wins):
        _run(win["stim_end"] - win["stim_start"], f"TEST {i+1}")
        _run(win["trial_end"] - win["stim_end"],  f"TEST {i+1} resp")
        _run(win["iti"],                           f"TEST {i+1} ITI")

    # Collect spikes
    spikes = {}
    for pid, rec in spike_recs.items():
        ev = nest.GetStatus(rec, "events")[0]
        spikes[pid] = {"senders": ev["senders"].tolist(), "times": ev["times"].tolist()}

    meta = {"sim_id": sim_id, "total_ms": total_time, "train_end_ms": train_end}
    sj = json.dumps({"metadata": meta, "spikes": spikes}).encode()
    minio_service.upload_file(io.BytesIO(sj), len(sj), f"{base_path}/spikes.json", "application/json")
    del sj; gc.collect()

    cond_rt: dict = {}  # populated in RMI block, consumed in CDF block

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:

        # --- Raster + PSTH plots (one pair per recorded population) ---
        _pop_size = {p["id"]: int(p["size"]) for p in pops_data}
        for pid, data in spikes.items():
            try:
                fig, ax = plt.subplots(figsize=(10, 4))
                if data["times"]:
                    ax.scatter(data["times"], data["senders"], s=1, color='#2563eb')
                ax.axvline(train_end, color='r', ls='--', lw=1, label='Train→Test')
                ax.set_title(f"Raster — {pid}")
                ax.set_xlabel("Time (ms)"); ax.set_ylabel("Neuron ID")
                ax.legend(fontsize=8)
                buf = io.BytesIO(); plt.savefig(buf, format='png', dpi=150, bbox_inches='tight'); plt.close()
                name = f"{pid}_raster.png"
                minio_service.upload_file(io.BytesIO(buf.getvalue()), len(buf.getvalue()), f"{base_path}/{name}", "image/png")
                zf.writestr(name, buf.getvalue()); del buf; gc.collect()
            except Exception as e:
                logger.warning(f"Raster plot failed for {pid}: {e}"); plt.close('all')

            try:
                n_mon = min(_pop_size.get(pid, 50), 250)
                psth_bin = 50.0
                h_edges = np.arange(0.0, total_time + psth_bin, psth_bin)
                h_counts, _ = np.histogram(np.asarray(data["times"], dtype=float), bins=h_edges)
                h_rate = h_counts * 1000.0 / (psth_bin * max(1, n_mon))
                fig_h, ax_h = plt.subplots(figsize=(10, 3))
                ax_h.bar(h_edges[:-1], h_rate, width=psth_bin * 0.9, color='#10b981', alpha=0.8)
                ax_h.axvline(train_end, color='r', ls='--', lw=1, label='Train→Test')
                ax_h.set_title(f"Firing Rate (PSTH) — {pid}")
                ax_h.set_xlabel("Time (ms)"); ax_h.set_ylabel("Rate (Hz)")
                ax_h.legend(fontsize=8)
                hbuf = io.BytesIO(); plt.savefig(hbuf, format='png', dpi=150, bbox_inches='tight'); plt.close()
                hname = f"{pid}_histogram.png"
                minio_service.upload_file(io.BytesIO(hbuf.getvalue()), len(hbuf.getvalue()), f"{base_path}/{hname}", "image/png")
                zf.writestr(hname, hbuf.getvalue()); del hbuf; gc.collect()
            except Exception as e:
                logger.warning(f"PSTH plot failed for {pid}: {e}"); plt.close('all')

        # --- DCN_A vs DCN_B differential ---
        if "DCN_A" in spikes and "DCN_B" in spikes:
            try:
                bins_e = np.arange(0, total_time + 50.0, 50.0)
                ha, _ = np.histogram(spikes["DCN_A"]["times"], bins=bins_e)
                hb, _ = np.histogram(spikes["DCN_B"]["times"], bins=bins_e)
                diff = (ha.astype(float) - hb.astype(float)) / (50.0 / 1000.0)
                fig, ax = plt.subplots(figsize=(10, 4))
                ax.plot(bins_e[:-1], diff, color='green', lw=1.2)
                ax.axhline(0, color='black', lw=0.8)
                ax.axvline(train_end, color='r', ls='--', lw=1, label='Train→Test')
                ax.set_title("DCN_A − DCN_B (Hz)"); ax.set_xlabel("Time (ms)"); ax.set_ylabel("Δ Rate (Hz)")
                ax.legend(fontsize=8)
                buf = io.BytesIO(); plt.savefig(buf, format='png', dpi=150); plt.close()
                minio_service.upload_file(io.BytesIO(buf.getvalue()), len(buf.getvalue()), f"{base_path}/diff_DCN_A_DCN_B.png", "image/png")
                zf.writestr("diff_DCN_A_DCN_B.png", buf.getvalue()); del buf; gc.collect()
            except Exception as e:
                logger.warning(f"Differential plot failed: {e}"); plt.close('all')

        # --- Race Model Inequality (differential DCN_A − DCN_B threshold RT) ---
        # The cerebellar metric is the DIFFERENTIAL firing rate (DCN_A − DCN_B),
        # matching the old implementation that used |rate_a − rate_b| > threshold.
        # DCN_B has no direct test stimulus (no VIS/AUD→DCN_B connections) so it
        # fires at tonic ~5.5 Hz throughout; DCN_A is elevated by VIS/AUD drive.
        # In AV trials (40 combined sources) DCN_A fires at ~2× the rate of A or V
        # alone → differential crosses threshold much faster → AV < A < V RT.
        if "DCN_A" in spikes and "DCN_B" in spikes:
            try:
                rt_cfg    = test_cfg.get("response", {})
                rt_bin    = float(rt_cfg.get("bin_ms", 5.0))
                rt_smooth = int(rt_cfg.get("smooth_bins", 10))
                base_ms   = float(rt_cfg.get("baseline_ms", 200.0))
                rt_delta  = float(rt_cfg.get("threshold_delta_hz", 15.0))

                edges = np.arange(0.0, total_time + rt_bin, rt_bin)

                def _smooth_rate(pop_times, n_neurons):
                    counts, _ = np.histogram(np.asarray(pop_times, dtype=float), bins=edges)
                    r = counts * 1000.0 / (rt_bin * max(1, n_neurons))
                    pad = rt_smooth // 2
                    p = np.concatenate([np.zeros(pad), r, np.zeros(pad)])
                    return np.convolve(p, np.ones(rt_smooth) / rt_smooth, mode="same")[pad:pad + len(r)]

                n_dcn_a = min(int(next((p["size"] for p in pops_data if p["id"] == "DCN_A"), 5)), 250)
                n_dcn_b = min(int(next((p["size"] for p in pops_data if p["id"] == "DCN_B"), 5)), 250)
                ma_a = _smooth_rate(spikes["DCN_A"]["times"], n_dcn_a)
                ma_b = _smooth_rate(spikes["DCN_B"]["times"], n_dcn_b)
                # RACE across populations: the response time of a trial is the
                # EARLIEST 15 Hz threshold crossing among ANY DCN population
                # (whichever side fires first wins), not a fixed DCN_A readout.
                _pop_rate = {"DCN_A": ma_a, "DCN_B": ma_b}
                centers = edges[:-1]

                # Minimum RT per condition: reject crossings that occur before the
                # modality's own afferent latency. DCN_A pacemaker fluctuations
                # produce false threshold crossings at 0-130ms even with no input;
                # this filter eliminates those pre-stimulus noise hits.
                # Use latency + connection_delay as the hard floor so pacemaker
                # noise before the stimulus even reaches DCN can never count as an RT.
                _dcn_delay = 20.0  # matches MF→DCN_A connection delay above
                _min_rt = {
                    "V":  max(0.0, vis_latency + _dcn_delay),
                    "A":  max(0.0, aud_latency + _dcn_delay),
                    "AV": max(0.0, aud_latency + _dcn_delay),
                }

                rt_winner: dict = {}  # cond -> list of winning population names
                for i, win in enumerate(test_wins):
                    cond = test_labels[i]
                    if cond == "CATCH":
                        continue
                    s0, te = win["stim_start"], win["trial_end"]
                    min_rt = _min_rt.get(cond, 0.0)
                    pm = (centers >= s0) & (centers <= te)
                    rt_offset = centers[pm] - s0
                    bm = (centers >= s0 - base_ms) & (centers < s0)
                    # Race: take the earliest valid crossing over all populations.
                    best_rt, best_pop = None, None
                    for pop_name, rate in _pop_rate.items():
                        baseline = float(rate[bm].mean()) if bm.any() else 0.0
                        thr = baseline + rt_delta
                        seg_r = rate[pm]
                        cross = np.where((seg_r >= thr) & (rt_offset >= min_rt))[0]
                        if len(cross):
                            cand = float(rt_offset[cross[0]])
                            if best_rt is None or cand < best_rt:
                                best_rt, best_pop = cand, pop_name
                    cond_rt.setdefault(cond, [])
                    rt_winner.setdefault(cond, [])
                    if best_rt is not None:
                        cond_rt[cond].append(best_rt)
                        rt_winner[cond].append(best_pop)

                v_rt  = cond_rt.get("V", [])
                a_rt  = cond_rt.get("A", [])
                av_rt = cond_rt.get("AV", [])
                logger.info(f"MSI Race: RTs detected — V:{len(v_rt)} A:{len(a_rt)} AV:{len(av_rt)}")

                rmi_entry = {
                    "population": "DCN (race: first of DCN_A/DCN_B)",
                    "winner_counts": {c: {p: w.count(p) for p in set(w)} for c, w in rt_winner.items()},
                    "method": "rate_threshold_crossing",
                    "threshold_delta_hz": rt_delta,
                    "baseline_window_ms": base_ms,
                    "n_V": len(v_rt), "n_A": len(a_rt), "n_AV": len(av_rt),
                    "median_rt_ms": {k: round(float(np.median(v)), 1) for k, v in cond_rt.items() if v},
                    "reaction_times_ms": {k: [round(x, 1) for x in v] for k, v in cond_rt.items()},
                    "has_facilitation": False, "max_rmi_violation": 0.0,
                }

                if v_rt and a_rt and av_rt:
                    t_max = float(max(v_rt + a_rt + av_rt))
                    time_pts = np.arange(0.0, t_max + rt_bin, rt_bin)

                    def ecdf(data, t_arr):
                        d = np.array(data)
                        return np.array([float(np.sum(d <= t)) / len(d) for t in t_arr])

                    cdf_v  = ecdf(v_rt, time_pts)
                    cdf_a  = ecdf(a_rt, time_pts)
                    cdf_av = ecdf(av_rt, time_pts)
                    rmi_bound = np.minimum(cdf_v + cdf_a, 1.0)
                    rmi_viol  = cdf_av - rmi_bound

                    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
                    ax1.plot(time_pts, cdf_v,  'b-',  lw=2,   label=f'V (n={len(v_rt)})')
                    ax1.plot(time_pts, cdf_a,  'r-',  lw=2,   label=f'A (n={len(a_rt)})')
                    ax1.plot(time_pts, cdf_av, 'g-',  lw=2.5, label=f'AV (n={len(av_rt)})')
                    ax1.plot(time_pts, rmi_bound, 'k--', lw=1.5, alpha=0.8, label='Miller Bound (V+A)')
                    ax1.fill_between(time_pts, rmi_bound, cdf_av, where=(cdf_av > rmi_bound),
                                     alpha=0.2, color='green', label='RMI Violation')
                    ax1.set_xlabel('Reaction Time (ms)'); ax1.set_ylabel('Cumulative Probability')
                    ax1.set_title('Race Model Inequality — cerebellar DCN (race)'); ax1.legend(fontsize=9)
                    ax1.grid(True, alpha=0.3); ax1.set_ylim(-0.05, 1.05)
                    ax2.plot(time_pts, rmi_viol, color='#16a34a', lw=2, label='AV − Miller Bound')
                    ax2.axhline(0, color='black', lw=1, ls='--')
                    ax2.fill_between(time_pts, 0, rmi_viol, where=(rmi_viol > 0),  alpha=0.3, color='green', label='Facilitation (MSI)')
                    ax2.fill_between(time_pts, rmi_viol, 0, where=(rmi_viol < 0), alpha=0.3, color='red',   label='No violation')
                    ax2.set_xlabel('Reaction Time (ms)'); ax2.set_ylabel('RMI Violation')
                    ax2.set_title('RMI Violation Curve'); ax2.legend(fontsize=9)
                    ax2.grid(True, alpha=0.3)
                    plt.tight_layout()
                    buf = io.BytesIO(); plt.savefig(buf, format='png', dpi=150, bbox_inches='tight'); plt.close()
                    minio_service.upload_file(io.BytesIO(buf.getvalue()), len(buf.getvalue()), f"{base_path}/rmi_DCN_A.png", "image/png")
                    zf.writestr("rmi_DCN_A.png", buf.getvalue()); del buf; gc.collect()
                    rmi_entry["max_rmi_violation"] = round(float(np.max(rmi_viol)), 4)
                    rmi_entry["has_facilitation"] = bool(np.any(rmi_viol > 0.05))

                # race_model.race_model must be an array (frontend uses .find())
                rmi_bytes = json.dumps({"race_model": [rmi_entry], "train_end_ms": train_end}, indent=2).encode()
                minio_service.upload_file(io.BytesIO(rmi_bytes), len(rmi_bytes), f"{base_path}/race_model.json", "application/json")
                zf.writestr("race_model.json", rmi_bytes); del rmi_bytes; gc.collect()
            except Exception as e:
                logger.warning(f"RMI analysis failed: {e}"); plt.close('all')

        # --- Activation plots, decision accuracy, CDF ---
        if "DCN_A" in spikes and "DCN_B" in spikes:
            try:
                ACT_BIN = 5.0

                def _ma_rate(times, n_mon):
                    n_mon = max(1, n_mon)
                    edges = np.arange(0.0, total_time + ACT_BIN, ACT_BIN)
                    counts, _ = np.histogram(np.asarray(times, dtype=float), bins=edges)
                    rate = counts * 1000.0 / (ACT_BIN * n_mon)
                    w = 10; pad = w // 2
                    padded = np.concatenate([np.zeros(pad), rate, np.zeros(pad)])
                    ma = np.convolve(padded, np.ones(w) / w, mode="same")[pad:pad + len(rate)]
                    return edges[:-1], ma

                n_a = min(int(next((p["size"] for p in pops_data if p["id"] == "DCN_A"), 5)), 250)
                n_b = min(int(next((p["size"] for p in pops_data if p["id"] == "DCN_B"), 5)), 250)
                centers_act, ma_a = _ma_rate(spikes["DCN_A"]["times"], n_a)
                _,           ma_b = _ma_rate(spikes["DCN_B"]["times"], n_b)
                cond_color = {"V": "#2563eb", "A": "#dc2626", "AV": "#16a34a", "CATCH": "#94a3b8"}

                def _activation_plot(t0, t1, title, fname):
                    m = (centers_act >= t0) & (centers_act <= t1)
                    fig = plt.figure(figsize=(12, 4.2)); ax = plt.gca()
                    seen = set()
                    for i, win in enumerate(test_wins):
                        if win["stim_start"] < t0 or win["stim_end"] > t1:
                            continue
                        cond = test_labels[i]; col = cond_color.get(cond, "#cbd5e1")
                        lbl = f"stim: {cond}" if cond not in seen else None; seen.add(cond)
                        ax.axvspan(win["stim_start"], win["stim_end"], color=col, alpha=0.13, label=lbl)
                    ax.plot(centers_act[m], ma_a[m], color="#2563eb", lw=1.3, label="DCN_A rate")
                    ax.plot(centers_act[m], ma_b[m], color="#dc2626", lw=1.3, label="DCN_B rate")
                    ax.set_xlabel("Time (ms)"); ax.set_ylabel("Firing rate (Hz)")
                    ax.set_title(title); ax.legend(fontsize=8, ncol=5, loc="upper right")
                    ax.grid(True, alpha=0.25)
                    buf = io.BytesIO(); plt.savefig(buf, format="png", dpi=150, bbox_inches="tight"); plt.close()
                    minio_service.upload_file(io.BytesIO(buf.getvalue()), len(buf.getvalue()), f"{base_path}/{fname}", "image/png")
                    zf.writestr(fname, buf.getvalue()); del buf; gc.collect()

                _activation_plot(0.0, train_end, "DCN activation — TRAINING", "activation_train_DCN_AB.png")
                _activation_plot(train_end, total_time, "DCN activation — TEST", "activation_test_DCN_AB.png")
            except Exception as e:
                logger.warning(f"Activation plots failed: {e}"); plt.close('all')

            try:
                tA = np.asarray(spikes["DCN_A"]["times"], dtype=float)
                tB = np.asarray(spikes["DCN_B"]["times"], dtype=float)
                comp, correct, valid = [], 0, 0
                for i, win in enumerate(test_wins):
                    s0, te = win["stim_start"], win["trial_end"]
                    cond = test_labels[i]
                    sa = int(np.sum((tA >= s0) & (tA <= te)))
                    sb = int(np.sum((tB >= s0) & (tB <= te)))
                    net = sa - sb
                    # Decision rule (Cavadini et al. 2025): "the half population activated the MOST
                    # encodes the response". DCN_B is held silent by PC_B inhibition,
                    # so any DCN_A activity on a stimulus trial is a correct decision.
                    # The previous ±10 margin discarded weak single-modality trials
                    # (V/A near the coactivation threshold) as TIE → spurious errors
                    # (~68% accuracy). CATCH trials are excluded from `valid` below,
                    # so a strict argmax cannot inflate the score. TIE only if neither
                    # population fired at all.
                    actual = "DCN_A" if net > 0 else "DCN_B" if net < 0 else "TIE"
                    expected = "TIE" if cond == "CATCH" else "DCN_A"
                    is_correct = None
                    if expected != "TIE":
                        valid += 1
                        is_correct = (actual == expected)
                        if is_correct:
                            correct += 1
                    comp.append({
                        "trial": i + 1, "active_stimuli": test_sequence[i], "condition_label": cond,
                        "expected_winner": expected, "actual_winner": actual,
                        "is_correct": is_correct, "net_evidence": net,
                    })
                acc_pct = round(correct / valid * 100, 2) if valid else 0.0
                logger.info(f"MSI Race: accuracy={acc_pct}% ({correct}/{valid})")
                acc_doc = {"metrics": [{"comparison": "DCN_A vs DCN_B (Test)", "accuracy_percent": acc_pct,
                                        "total_valid_trials": valid, "correct_trials": correct, "trial_details": comp}]}
                acc_bytes = json.dumps(acc_doc, indent=2).encode()
                minio_service.upload_file(io.BytesIO(acc_bytes), len(acc_bytes), f"{base_path}/accuracy_metrics.json", "application/json")
                zf.writestr("accuracy_metrics.json", acc_bytes); del acc_bytes; gc.collect()
            except Exception as e:
                logger.warning(f"Decision accuracy failed: {e}")

            try:
                cond_color = {"V": "#2563eb", "A": "#dc2626", "AV": "#16a34a"}
                fig = plt.figure(figsize=(8, 5)); any_c = False
                for cond in ("V", "A", "AV"):
                    rts = cond_rt.get(cond, [])
                    if not rts:
                        continue
                    counts, edges = np.histogram(rts, bins=10)
                    s = counts.sum()
                    if s == 0:
                        continue
                    plt.plot(edges[1:], np.cumsum(counts / s), "--o",
                             color=cond_color.get(cond, "#888"), label=f"{cond} (n={len(rts)})")
                    any_c = True
                plt.xlim(0, 600); plt.ylim(0, 1.1)
                plt.xlabel("Response time (ms)"); plt.ylabel("Cumulative probability")
                plt.title("Response-time CDF — cerebellar DCN race (per condition)")
                if any_c:
                    plt.legend(fontsize=9)
                plt.grid(alpha=0.3)
                buf = io.BytesIO(); plt.savefig(buf, format="png", dpi=150, bbox_inches="tight"); plt.close()
                minio_service.upload_file(io.BytesIO(buf.getvalue()), len(buf.getvalue()), f"{base_path}/cdf_test_DCN_AB.png", "image/png")
                zf.writestr("cdf_test_DCN_AB.png", buf.getvalue()); del buf; gc.collect()
            except Exception as e:
                logger.warning(f"CDF plot failed: {e}"); plt.close('all')

            try:
                median_by_cond = {k: round(float(np.median(v)), 1) for k, v in cond_rt.items() if v}
                resp_doc = {"populations": [
                    {"pop_a": "train", "pop_b": "DCN_AB", "label": "Attivazione DCN — Training"},
                    {"pop_a": "test",  "pop_b": "DCN_AB", "label": "Attivazione DCN — Test",
                     "median_by_condition": median_by_cond,
                     "count_by_condition": {k: len(v) for k, v in cond_rt.items()}},
                ]}
                resp_bytes = json.dumps(resp_doc, indent=2).encode()
                minio_service.upload_file(io.BytesIO(resp_bytes), len(resp_bytes), f"{base_path}/response_times.json", "application/json")
                zf.writestr("response_times.json", resp_bytes); del resp_bytes; gc.collect()
            except Exception as e:
                logger.warning(f"Response times JSON failed: {e}")

    zip_buf.seek(0)
    minio_service.upload_file(io.BytesIO(zip_buf.getvalue()), len(zip_buf.getvalue()),
                              f"{base_path}/graphs.zip", "application/zip")
    progress_cb(100, "DONE")
    logger.info(f"cerebellum_msi_race sim {sim_id} completed. train_end={train_end:.0f}ms total={total_time:.0f}ms")
