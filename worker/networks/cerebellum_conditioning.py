"""
Cerebellar associative conditioning experiment — NEST 2.18 → 3.8 port.

Training phase  (plasticity ON):  n_train trials, each with auditory OR visual stimulus.
Test phase      (plasticity OFF):  n_test trials × 3 conditions (auditory / visual / audiovisual).

Trial structure: 3000 ms/trial. The sensory Poisson drive starts at the modality
latency (auditory 150 ms, visual 220 ms) and stops at 600 ms, as in the legacy
execution_types.json; responses are read over the first 1000 ms.
IO teaching signal: 8.5 Hz Poisson, 300–600 ms into each training trial.

Config source: data/config/network_config.json + cerebellum_simple.py (musin-backend-1.0.0)

Neuron models: GR, PC and DCN are iaf_cond_exp with the legacy parameters, IO is a
parrot relay (same as cerebellum_simple.py). The CerebNEST eglif_dcnp model cannot be
used for the DCN: any input on its receptor 2 triggers one spike per input spike, so
PC→DCN "inhibition" acts as excitation and the lateralisation comes out inverted.
iaf_cond_exp selects the inhibitory conductance by the SIGN of the weight.

Plasticity note: NEST 3.8 has no volume_transmitter_alberto; cerebellar LTD is implemented
manually after each training trial by reading GR + IO spike recorders and updating
GR→PC static-synapse weights according to CF-gated anti-Hebbian depression.
"""

import gc
import random
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

from worker.analysis import cf_gated_ltd
from worker.results import ResultStore

# ── Fixed protocol constants (from network_config.json) ─────────────────────
TRIAL_MS        = 3000.0   # total trial window
STIM_MS         = 1000.0   # response window within trial
STIM_STOP_MS    = 600.0    # sensory drive offset within trial (execution_types.json)
LATENCY_MS      = {'aud': 150.0, 'vis': 220.0}   # first-spike latency per modality
IO_START_MS     = 300.0    # IO teaching onset within trial
IO_STOP_MS      = 600.0    # IO teaching offset within trial
IO_RATE         = 8.5      # Hz, IO Poisson rate
STIM_RATE       = 30.0     # Hz, sensory Poisson rate (execution_types.json)
N_STIM_NEURONS  = 80       # parrot neurons per stimulus channel (execution_types.json)
BIN_MS          = 5.0      # rate-bin size
MA_WINDOW       = 10       # moving-average window (bins)
RT_THRESHOLD    = 15.0     # Hz, |rate_A − rate_B| threshold for response-time detection
COND_NAMES      = {'auditory': 'uditivo', 'visual': 'visivo', 'audiovisual': 'audiovisivo'}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _bin_rates(times, n_neurons, t_start, t_end, bin_ms=BIN_MS):
    bins  = np.arange(t_start, t_end + bin_ms, bin_ms)
    t_arr = np.asarray(times)
    mask  = (t_arr >= t_start) & (t_arr < t_end)
    counts, _ = np.histogram(t_arr[mask], bins=bins)
    rates = counts * 1000.0 / (bin_ms * max(n_neurons, 1))
    return bins[:-1], rates


def _moving_average(arr, window=MA_WINDOW):
    """Trailing mean: bin i averages bins i-window+1..i, so a threshold crossing
    can never precede the spikes that cause it (a centred window would)."""
    return np.convolve(arr, np.ones(window) / window, mode='full')[:len(arr)]


def _response_time(ma_a, ma_b, t_bins, trial_start_ms, threshold=RT_THRESHOLD):
    """First bin where |rate_A − rate_B| ≥ threshold within the trial window."""
    diff = np.abs(np.asarray(ma_a) - np.asarray(ma_b))
    mask = (t_bins >= trial_start_ms) & (t_bins < trial_start_ms + TRIAL_MS)
    local_diff = diff[mask]
    local_bins = t_bins[mask]
    hits = np.where(local_diff >= threshold)[0]
    if len(hits):
        return float(local_bins[hits[0]] - trial_start_ms)
    return float('nan')


# ── Network builder ──────────────────────────────────────────────────────────

def _build_network(nest, par):
    GR_num  = par['GR_num']           # 2000
    PC_num  = par['PC_num']           # 100
    DCN_num = PC_num // 2             # 50

    # Granule cells — iaf_cond_exp (unchanged from legacy)
    GR = nest.Create('iaf_cond_exp', GR_num, params={
        't_ref': 1.0, 'C_m': 2.0, 'V_th': -40.0, 'V_reset': -70.0,
        'g_L': 0.2, 'tau_syn_ex': 0.5, 'tau_syn_in': 10.0, 'E_L': -70.0,
    })

    # Purkinje cells — iaf_cond_exp (legacy purkinje_neuron)
    PC = nest.Create('iaf_cond_exp', PC_num, params={
        't_ref': 2.0, 'C_m': 400.0, 'V_th': -52.0, 'V_reset': -70.0,
        'g_L': 16.0, 'tau_syn_ex': 0.5, 'tau_syn_in': 1.6, 'E_L': -70.0,
    })

    # IO as parrot neurons (relays teaching signal, same as legacy)
    IO = nest.Create('parrot_neuron', PC_num)

    # DCN — iaf_cond_exp (legacy nuclear_neuron)
    DCN = nest.Create('iaf_cond_exp', DCN_num, params={
        't_ref': 1.0, 'C_m': 2.0, 'V_th': -40.0, 'V_reset': -70.0,
        'g_L': 0.2, 'tau_syn_ex': 0.5, 'tau_syn_in': 10.0, 'E_L': -70.0,
    })

    # Stimulus parrot neuron banks (4 channels)
    PA_aud = nest.Create('parrot_neuron', N_STIM_NEURONS)
    PA_vis = nest.Create('parrot_neuron', N_STIM_NEURONS)
    PB_aud = nest.Create('parrot_neuron', N_STIM_NEURONS)
    PB_vis = nest.Create('parrot_neuron', N_STIM_NEURONS)

    # Spike recorders
    sr_DCN_a = nest.Create('spike_recorder')
    sr_DCN_b = nest.Create('spike_recorder')
    sr_PC    = nest.Create('spike_recorder')
    sr_IO    = nest.Create('spike_recorder')
    sr_GR    = nest.Create('spike_recorder')   # used during training for LTD

    DCN_a = DCN[:DCN_num // 2]
    DCN_b = DCN[DCN_num // 2:]
    nest.Connect(DCN_a, sr_DCN_a)
    nest.Connect(DCN_b, sr_DCN_b)
    nest.Connect(PC,    sr_PC)
    nest.Connect(IO,    sr_IO)
    nest.Connect(GR,    sr_GR)

    # ── GR connections: each GR gets 4 pre-synaptic inputs (2 aud + 2 vis)
    #    from one randomly chosen side (A or B).
    #    Build flat integer arrays of node IDs for NEST 3.8 one_to_one.
    rng = random.Random(int(par.get('seed', 1234)))
    n   = N_STIM_NEURONS - 1

    # Pre-extract all global IDs to avoid repeated NodeCollection indexing
    pa_aud_ids = list(PA_aud.global_id)
    pa_vis_ids = list(PA_vis.global_id)
    pb_aud_ids = list(PB_aud.global_id)
    pb_vis_ids = list(PB_vis.global_id)
    gr_ids     = list(GR.global_id)

    pre_ids  = []
    post_ids = []

    for gr_id in gr_ids:
        side = rng.randint(0, 1)
        aud_ids = pa_aud_ids if side == 0 else pb_aud_ids
        vis_ids = pa_vis_ids if side == 0 else pb_vis_ids
        pre_ids.extend([
            aud_ids[rng.randint(0, n)],
            aud_ids[rng.randint(0, n)],
            vis_ids[rng.randint(0, n)],
            vis_ids[rng.randint(0, n)],
        ])
        post_ids.extend([gr_id, gr_id, gr_id, gr_id])

    rng_np = np.random.default_rng(int(par.get('seed', 1234)) + 1)
    mf_weights = rng_np.uniform(0.55, 1.5, size=len(pre_ids)).astype(np.float64)
    mf_delays  = np.ones(len(pre_ids), dtype=np.float64)

    nest.Connect(np.array(pre_ids, dtype=np.uint64),
                 np.array(post_ids, dtype=np.uint64),
                 'one_to_one',
                 {'synapse_model': 'static_synapse',
                  'weight': mf_weights, 'delay': mf_delays})

    # ── PF–PC static synapses
    # Plasticity is applied manually after each training trial via
    # _apply_ltd_step(), which reads GR/IO spike recorders and updates weights.
    # This replaces stdp_synapse_sinexp which lacks volume_transmitter in NEST 3.8.
    for PCi in PC:
        nest.Connect(GR, PCi,
                     {'rule': 'fixed_indegree', 'indegree': int(0.8 * GR_num)},
                     {'synapse_model': 'static_synapse',
                      'weight': float(par['Init_PFPC']),   # 4.0
                      'delay': 1.0})

    # Cache the full PF-PC SynapseCollection for efficient weight updates
    pfpc_conns = nest.GetConnections(GR, PC)

    # The climbing fibre has no synapse onto the PC here: as in the legacy model
    # (IO → volume transmitter) it only gates plasticity, see _apply_ltd_step().

    # ── All stimulus channels → DCN  (excitatory mossy-fibre collateral)
    for ch in [PA_aud, PA_vis, PB_aud, PB_vis]:
        nest.Connect(ch, DCN, 'all_to_all', {
            'synapse_model': 'static_synapse',
            'weight': nest.random.uniform(min=float(par['Init_MFDCN_low']),
                                          max=float(par['Init_MFDCN_high'])),
            'delay': 20.0,
        })

    # ── PC → DCN  (inhibitory): 2 PCs per DCN cell, negative weight
    count_dcn = 0
    for p_idx in range(PC_num):
        nest.Connect(PC[p_idx], DCN[count_dcn], 'one_to_one', {
            'synapse_model': 'static_synapse',
            'weight': -abs(float(par['Init_PCDCN'])),   # -20.0
            'delay': 1.0,
        })
        if p_idx % 2 == 1:
            count_dcn += 1

    io_ids   = list(IO.global_id)
    io_half  = len(io_ids) // 2
    pc_ids   = list(PC.global_id)
    pc_half  = len(pc_ids) // 2

    return dict(
        GR=GR, PC=PC, IO=IO, DCN=DCN,
        DCN_a=DCN_a, DCN_b=DCN_b,
        PA_aud=PA_aud, PA_vis=PA_vis, PB_aud=PB_aud, PB_vis=PB_vis,
        sr_DCN_a=sr_DCN_a, sr_DCN_b=sr_DCN_b, sr_PC=sr_PC, sr_IO=sr_IO, sr_GR=sr_GR,
        pfpc_conns=pfpc_conns,
        pfpc_sources=np.asarray(pfpc_conns.get('source')),
        pfpc_to_side_a=np.isin(np.asarray(pfpc_conns.get('target')), pc_ids[:pc_half]),
        io_a_ids=set(io_ids[:io_half]),
        io_b_ids=set(io_ids[io_half:]),
        pc_a_ids=set(pc_ids[:pc_half]),
        pc_b_ids=set(pc_ids[pc_half:]),
        PC_num=PC_num, DCN_num=DCN_num,
    )


def _apply_ltd_step(nest, net, trial_t0, par):
    """
    CF-gated LTD: after each training trial, depress PF→PC weights for
    co-active GR→PC pairs where the corresponding PC received a CF (IO) spike.

    LTD rule: ΔW = -LTD_rate  for each (GR, PC) where GR fired in [t0, t0+STIM_MS]
              AND PC is in CF-active set (IO fired in IO window for that side)
    LTP rule: ΔW = +LTP_rate  for inactive GR→PC pairs (slow recovery toward Init_PFPC)
    """
    LTD_RATE = abs(par['LTD1']) * 0.25     # 1.5 per co-active trial → weights hit 0 in ~3 trials
    LTP_RATE = par['LTP1']      * 0.005    # 0.00025 recovery per trial
    W_MIN    = 0.0
    W_MAX    = par['Init_PFPC'] * 1.5      # 6.0

    # Which IO neurons fired in the IO window → which PC side received CF
    io_evts = net['sr_IO'].get('events')
    io_t    = np.asarray(io_evts['times'])
    io_s    = np.asarray(io_evts['senders'], dtype=int)
    io_win_mask = (io_t >= trial_t0 + IO_START_MS) & (io_t < trial_t0 + IO_STOP_MS)
    fired_io = set(io_s[io_win_mask].tolist())

    cf_a = bool(fired_io & net['io_a_ids'])   # CF arrived at side-A PCs
    cf_b = bool(fired_io & net['io_b_ids'])   # CF arrived at side-B PCs

    if not cf_a and not cf_b:
        return   # no CF fired this trial — no plasticity

    # GRs that fired during stimulus window
    gr_evts = net['sr_GR'].get('events')
    gr_t    = np.asarray(gr_evts['times'])
    gr_s    = np.asarray(gr_evts['senders'], dtype=int)
    stim_mask   = (gr_t >= trial_t0) & (gr_t < trial_t0 + STIM_MS)
    active_grs  = set(gr_s[stim_mask].tolist())

    if not active_grs:
        return

    pfpc = net['pfpc_conns']
    weights = np.asarray(nest.GetStatus(pfpc, 'weight'), dtype=float)
    cf_on_target = (net['pfpc_to_side_a'] & cf_a) | (~net['pfpc_to_side_a'] & cf_b)
    depress = np.isin(net['pfpc_sources'], list(active_grs)) & cf_on_target
    nest.SetStatus(pfpc, 'weight', cf_gated_ltd(weights, depress, LTD_RATE, LTP_RATE, W_MIN, W_MAX).tolist())


def _add_stim(nest, net, global_trial_idx, channel_keys):
    """Create one poisson_generator per active channel for this trial."""
    t0 = global_trial_idx * TRIAL_MS
    for ch_key in channel_keys:
        latency = LATENCY_MS[ch_key.split('_')[1]]   # 'PA_aud' -> 'aud'
        pg = nest.Create('poisson_generator', params={
            'rate': STIM_RATE,
            'start': float(t0 + latency),
            'stop':  float(t0 + STIM_STOP_MS),
        })
        nest.Connect(pg, net[ch_key], 'all_to_all')


def _add_io(nest, net, global_trial_idx, side_a):
    """Create IO teaching-signal generator for one training trial."""
    t0 = global_trial_idx * TRIAL_MS
    pg = nest.Create('poisson_generator', params={
        'rate':  IO_RATE,
        'start': float(t0 + IO_START_MS),
        'stop':  float(t0 + IO_STOP_MS),
    })
    IO_half = len(net['IO']) // 2
    target = net['IO'][:IO_half] if side_a else net['IO'][IO_half:]
    nest.Connect(pg, target, 'all_to_all')


# ── Main entry point ─────────────────────────────────────────────────────────

def run_cerebellum_conditioning(task, sim_id_dict, exp_params, storage, progress_cb):
    """
    Full cerebellar conditioning: training + test.
    Called from worker/tasks.py when builtin == 'cerebellum_conditioning'.
    """
    import nest

    # Parameters from network_config.json defaults; overrideable via exp_params
    par = {
        'LTP1': 0.05, 'LTD1': -6.0, 'Init_PFPC': 4.0,
        'Init_MFDCN_low': 0.06, 'Init_MFDCN_high': 0.11,
        'Init_PCDCN': -20.0,
        'GR_num': 2000, 'PC_num': 100,
        'seed': 1234,
    }
    for k in list(par.keys()):
        if k in exp_params:
            par[k] = exp_params[k]

    n_train = int(exp_params.get('n_train', 20))
    n_test  = int(exp_params.get('n_test',  20))

    owner_id  = sim_id_dict['owner_id']
    sim_id    = sim_id_dict['sim_id']
    base_path = f"results/{owner_id}/sim_{sim_id}"

    # ── Randomized, balanced experimental design ──────────────────
    # Training: balanced A/B sides + balanced auditory/visual modality, shuffled order.
    # Test: 3 conditions × n_test, each balanced A/B, then ALL trials interleaved
    #       (shuffled together) so conditions and sides are randomized — this avoids
    #       order/statistical artefacts from running condition-blocks back to back.
    rng_design = random.Random(int(par['seed']))

    def _balanced_sides(n):
        """Return n booleans (side_a) with balanced True/False, shuffled."""
        sides = [True] * ((n + 1) // 2) + [False] * (n // 2)
        rng_design.shuffle(sides)
        return sides

    # Training specs: list of (side_a, modality)
    train_sides = _balanced_sides(n_train)
    train_mods  = (['auditory', 'visual'] * ((n_train + 1) // 2))[:n_train]
    rng_design.shuffle(train_mods)
    train_specs = list(zip(train_sides, train_mods))

    # Test specs: list of (condition, side_a), interleaved across conditions
    test_specs = []
    for cond in ('auditory', 'visual', 'audiovisual'):
        for s in _balanced_sides(n_test):
            test_specs.append((cond, s))
    rng_design.shuffle(test_specs)

    # Human-readable sequences for the metrics JSON
    train_modality = [m for (_s, m) in train_specs]
    train_side_seq = ['A' if s else 'B' for (s, _m) in train_specs]
    test_sequence  = [{'condition': c, 'side': 'A' if s else 'B'} for (c, s) in test_specs]

    # ── NEST kernel ──────────────────────────────────────────────
    progress_cb(3, "Avvio del kernel NEST")
    nest.ResetKernel()
    nest.SetKernelStatus({
        'resolution': 0.1,
        'rng_seed':   int(par['seed']),
        'local_num_threads': 6,
    })

    # ── Build network ────────────────────────────────────────────
    progress_cb(8, "Costruzione del microcircuito")
    net = _build_network(nest, par)

    train_time         = n_train * TRIAL_MS          # 60 000 ms
    test_time_per_type = n_test  * TRIAL_MS          # 60 000 ms
    total_time         = train_time + test_time_per_type * 3

    # ── Training phase: trial-by-trial to allow weight updates ───
    progress_cb(12, "Addestramento")
    for t, (side_a, mod) in enumerate(train_specs):
        if mod == 'auditory':
            ch_keys = ['PA_aud'] if side_a else ['PB_aud']
        else:
            ch_keys = ['PA_vis'] if side_a else ['PB_vis']
        _add_stim(nest, net, t, ch_keys)
        _add_io(nest, net, t, side_a)

        nest.Simulate(TRIAL_MS)

        _apply_ltd_step(nest, net, t * TRIAL_MS, par)

        pct = 12 + int(38 * (t + 1) / n_train)
        progress_cb(pct, f"Addestramento {t+1}/{n_train}")
        gc.collect()

    # ── Test stimuli (plasticity frozen — no weight updates) ─────
    # Conditions and sides are interleaved (see test_specs) to avoid block artefacts.
    progress_cb(52, "Preparazione degli stimoli di test")
    for k, (cond, side_a) in enumerate(test_specs):
        g = n_train + k
        if cond == 'auditory':
            ch_keys = ['PA_aud'] if side_a else ['PB_aud']
        elif cond == 'visual':
            ch_keys = ['PA_vis'] if side_a else ['PB_vis']
        else:  # audiovisual
            ch_keys = ['PA_aud', 'PA_vis'] if side_a else ['PB_aud', 'PB_vis']
        _add_stim(nest, net, g, ch_keys)

    # ── Simulate test phase in chunks ────────────────────────────
    progress_cb(54, "Test")
    chunk    = 5000.0
    simmed   = 0.0
    test_total = test_time_per_type * 3
    while simmed < test_total:
        step = min(chunk, test_total - simmed)
        nest.Simulate(step)
        simmed += step
        pct = 54 + int(32 * simmed / test_total)
        progress_cb(pct, f"Test: {int(simmed/1000)} di {int(test_total/1000)} s")
        gc.collect()

    # ── Extract spikes ───────────────────────────────────────────
    progress_cb(87, "Analisi")

    def _get(sr):
        ev = sr.get('events')
        return np.asarray(ev['senders'], dtype=int), np.asarray(ev['times'], dtype=float)

    snd_a, t_a = _get(net['sr_DCN_a'])
    snd_b, t_b = _get(net['sr_DCN_b'])
    snd_pc, t_pc = _get(net['sr_PC'])
    snd_gr, t_gr = _get(net['sr_GR'])
    snd_io, t_io = _get(net['sr_IO'])

    DCN_a_n = len(net['DCN_a'])
    DCN_b_n = len(net['DCN_b'])
    PC_n    = net['PC_num']

    t_bins_a, rates_a = _bin_rates(t_a, DCN_a_n, 0, total_time)
    t_bins_b, rates_b = _bin_rates(t_b, DCN_b_n, 0, total_time)
    ma_a = _moving_average(rates_a)
    ma_b = _moving_average(rates_b)

    t_bins_pc, rates_pc = _bin_rates(t_pc, PC_n, 0, total_time)
    ma_pc = _moving_average(rates_pc)

    # Baseline from last ITI of training
    baseline_win = 1000.0
    baseline_t0  = train_time - baseline_win
    base_a_hz = len(t_a[(t_a >= baseline_t0) & (t_a < train_time)]) / baseline_win * 1000.0 / max(DCN_a_n, 1)
    base_b_hz = len(t_b[(t_b >= baseline_t0) & (t_b < train_time)]) / baseline_win * 1000.0 / max(DCN_b_n, 1)

    cond_labels   = ('auditory', 'visual', 'audiovisual')
    rt_by_cond    = {lbl: [] for lbl in cond_labels}
    trial_results = []

    for k, (cond, side_a) in enumerate(test_specs):
        g       = n_train + k
        t0      = g * TRIAL_MS
        t1_stim = t0 + STIM_MS

        rt = _response_time(ma_a, ma_b, t_bins_a, t0)
        rt_by_cond[cond].append(rt)

        spk_a = int(np.sum((t_a >= t0) & (t_a < t1_stim)))
        spk_b = int(np.sum((t_b >= t0) & (t_b < t1_stim)))
        expected_baseline_a = base_a_hz * STIM_MS / 1000.0 * DCN_a_n
        expected_baseline_b = base_b_hz * STIM_MS / 1000.0 * DCN_b_n
        delta_a  = spk_a - expected_baseline_a
        delta_b  = spk_b - expected_baseline_b
        winner   = 'DCN_A' if delta_a > delta_b else 'DCN_B' if delta_b > delta_a else 'none'
        expected = 'DCN_A' if side_a else 'DCN_B'

        trial_results.append({
            'trial': g, 'condition': cond,
            'side': 'A' if side_a else 'B',
            'expected': expected, 'winner': winner,
            'correct': winner == expected,
            'response_time_ms': None if np.isnan(rt) else rt,
            'spikes_DCN_A': spk_a, 'spikes_DCN_B': spk_b,
            'delta_A': float(delta_a), 'delta_B': float(delta_b),
        })

    # A trial with no DCN spikes on either side is a miss ('none'): it counts
    # against accuracy but is reported separately from a wrong-side response.
    accuracy  = {}
    outcomes  = {}
    median_rt = {}
    for lbl in cond_labels:
        cond_tr       = [r for r in trial_results if r['condition'] == lbl]
        n_correct     = sum(1 for r in cond_tr if r['correct'])
        n_missed      = sum(1 for r in cond_tr if r['winner'] == 'none')
        outcomes[lbl] = {'correct': n_correct, 'wrong_side': len(cond_tr) - n_correct - n_missed,
                         'no_response': n_missed, 'trials': len(cond_tr)}
        accuracy[lbl] = round(100.0 * n_correct / max(len(cond_tr), 1), 1)
        valid_rts     = [r for r in rt_by_cond[lbl] if not np.isnan(r)]
        median_rt[lbl] = float(np.median(valid_rts)) if valid_rts else None

    # ── Final PF–PC weight stats for diagnostics ─────────────────
    final_weights = np.asarray(nest.GetStatus(net['pfpc_conns'], 'weight'), dtype=float)
    weight_stats = {
        'mean': float(np.mean(final_weights)),
        'min':  float(np.min(final_weights)),
        'max':  float(np.max(final_weights)),
        'frac_depressed': float(np.mean(final_weights < par['Init_PFPC'] * 0.8)),
    }

    # ── Plots ────────────────────────────────────────────────────
    progress_cb(88, "Grafici")
    colors = {'auditory': '#f4a261', 'visual': '#457b9d', 'audiovisual': '#2a9d8f'}

    store = ResultStore(storage, base_path)

    def _upload(fig, name):
        store.put_figure(name, fig, dpi=120)

    # 1. DCN + PC rates — full timeline
    fig, axes = plt.subplots(2, 1, figsize=(18, 8), sharex=True)
    ts = t_bins_a / 1000.0
    l1, = axes[0].plot(ts, ma_a, color='#264653', lw=1.2, label='DCN_A (lato A)')
    l2, = axes[0].plot(ts, ma_b, color='#e76f51', lw=1.2, label='DCN_B (lato B)', alpha=0.85)
    vline = axes[0].axvline(train_time / 1000.0, color='black', ls='--', lw=1, alpha=0.6, label='Inizio test')
    # Conditions are interleaved during test: shade each test-trial stimulus window by condition
    for k, (cond, _side) in enumerate(test_specs):
        x0 = (n_train + k) * TRIAL_MS / 1000.0
        axes[0].axvspan(x0, x0 + STIM_MS / 1000.0, alpha=0.15, color=colors[cond])
    cond_patches = [mpatches.Patch(color=colors[c], alpha=0.4, label=f'Test: {COND_NAMES[c]}') for c in colors]
    axes[0].set_ylabel('DCN (Hz per neurone)')
    axes[0].set_title('Attività dei DCN (sfondo: condizione dei trial di test)')
    axes[0].legend(handles=[l1, l2, vline] + cond_patches, fontsize=7, ncol=3)

    axes[1].plot(t_bins_pc / 1000.0, ma_pc, color='#2a9d8f', lw=1.0, label='PC')
    axes[1].axvline(train_time / 1000.0, color='black', ls='--', lw=1, alpha=0.6)
    axes[1].set_xlabel('Tempo (s)')
    axes[1].set_ylabel('PC (Hz per neurone)')
    axes[1].set_title('Attività delle cellule di Purkinje')
    axes[1].legend(fontsize=7)
    fig.tight_layout()
    _upload(fig, 'exp_attivita_DCN_e_PC.png')

    # 2. Response-time CDF (test phase)
    fig, ax = plt.subplots(figsize=(8, 5))
    for lbl, rts in rt_by_cond.items():
        valid = [r for r in rts if not np.isnan(r) and r < TRIAL_MS]
        if valid:
            cnt, bins = np.histogram(valid, bins=10)
            cdf = np.cumsum(cnt / max(cnt.sum(), 1))
            ax.plot(bins[1:], cdf, '--o', label=COND_NAMES[lbl], color=colors.get(lbl, 'gray'), lw=1.5)
    ax.set_xlim(0, 1000)
    ax.set_ylim(0, 1.1)
    ax.set_xlabel('Tempo di risposta (ms)')
    ax.set_ylabel('Frazione cumulativa delle risposte')
    ax.set_title('Tempi di risposta nel test, per condizione')
    ax.legend()
    fig.tight_layout()
    _upload(fig, 'exp_tempi_di_risposta.png')

    # 3. DCN raster — test phase
    fig, axes = plt.subplots(2, 1, figsize=(16, 6), sharex=True)
    mask_a = t_a >= train_time
    mask_b = t_b >= train_time
    axes[0].scatter((t_a[mask_a]) / 1000.0, snd_a[mask_a], s=0.4, color='#264653', alpha=0.5)
    axes[0].set_ylabel('ID neurone DCN_A')
    axes[0].set_title('Raster DCN_A nel test')
    axes[1].scatter((t_b[mask_b]) / 1000.0, snd_b[mask_b], s=0.4, color='#e76f51', alpha=0.5)
    axes[1].set_ylabel('ID neurone DCN_B')
    axes[1].set_title('Raster DCN_B nel test')
    axes[1].set_xlabel('Tempo (s)')
    # Shade each interleaved test-trial stimulus window by its condition
    for k, (cond, _side) in enumerate(test_specs):
        x0 = (n_train + k) * TRIAL_MS / 1000.0
        for ax_ in axes:
            ax_.axvspan(x0, x0 + STIM_MS / 1000.0, alpha=0.12, color=colors[cond])
    fig.tight_layout()
    _upload(fig, 'exp_raster_DCN_nel_test.png')

    # 4. Trial outcomes by condition
    fig, ax = plt.subplots(figsize=(6, 4))
    lbls = list(outcomes.keys())
    bottom = np.zeros(len(lbls))
    for key, label, color in (('correct', 'Lato corretto', '#2a9d8f'),
                              ('wrong_side', 'Lato sbagliato', '#e76f51'),
                              ('no_response', 'Nessuna risposta', '#cbd5e1')):
        vals = np.array([100.0 * outcomes[l][key] / max(outcomes[l]['trials'], 1) for l in lbls])
        ax.bar([COND_NAMES[l] for l in lbls], vals, bottom=bottom, color=color, width=0.5, label=label)
        bottom += vals
    ax.axhline(50, color='black', ls='--', lw=1, alpha=0.5)
    ax.set_ylim(0, 100)
    ax.set_ylabel('Trial di test (%)')
    ax.set_title('Esito della lateralizzazione per condizione')
    ax.legend(fontsize=8, loc='lower right')
    fig.tight_layout()
    _upload(fig, 'exp_esiti_per_condizione.png')

    # 5. PF-PC weight distribution before and after training
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.hist(final_weights, bins=50, color='#264653', alpha=0.8, edgecolor='white')
    ax.axvline(par['Init_PFPC'], color='red', ls='--', lw=1.5, label=f'Peso iniziale ({par["Init_PFPC"]})')
    ax.set_xlabel('Peso della sinapsi GR→PC')
    ax.set_ylabel('Sinapsi')
    ax.set_title(f'Pesi GR→PC dopo l\'addestramento (media {weight_stats["mean"]:.2f}, '
                 f'{100*weight_stats["frac_depressed"]:.0f}% depresse)')
    ax.legend()
    fig.tight_layout()
    _upload(fig, 'exp_pesi_GR_PC.png')

    # 6. Per-trial timeline: winner annotation on activation
    fig, ax = plt.subplots(figsize=(18, 5))
    ax.plot(t_bins_a / 1000.0, ma_a, color='#264653', lw=1.1, label='DCN_A')
    ax.plot(t_bins_b / 1000.0, ma_b, color='#e76f51', lw=1.1, label='DCN_B', alpha=0.8)
    ax.axvline(train_time / 1000.0, color='black', ls='--', lw=1, alpha=0.7)
    for r in trial_results:
        t0_s = r['trial'] * TRIAL_MS / 1000.0
        clr  = '#2a9d8f' if r['correct'] else '#e9c46a'
        ax.axvspan(t0_s, t0_s + STIM_MS / 1000.0, alpha=0.18, color=clr)
    ax.set_xlabel('Tempo (s)')
    ax.set_ylabel('Hz per neurone')
    ax.set_title('Attività dei DCN nel test (verde: trial corretto, giallo: errore)')
    ax.legend(fontsize=8)
    fig.tight_layout()
    _upload(fig, 'exp_esito_dei_trial.png')

    # ── Per-population raster + PSTH ──────────────────────────────
    # These match the population ids in the network definition (GR, PC, IO,
    # DCN_A, DCN_B), so the generic "Raster Plots & PSTH per Popolazione"
    # section in the UI renders them via {pop_id}_raster.png / {pop_id}_histogram.png.
    progress_cb(92, "Grafici per popolazione")
    pop_specs = [
        ('GR',    snd_gr, t_gr, par['GR_num']),
        ('PC',    snd_pc, t_pc, PC_n),
        ('IO',    snd_io, t_io, len(net['IO'])),
        ('DCN_A', snd_a,  t_a,  DCN_a_n),
        ('DCN_B', snd_b,  t_b,  DCN_b_n),
    ]
    rng_plot = np.random.default_rng(0)
    for pop_id, snd, tms, n_neu in pop_specs:
        # Raster (subsample dense populations to keep the PNG light)
        fig, ax = plt.subplots(figsize=(16, 4))
        if len(tms) > 80000:
            idx = rng_plot.choice(len(tms), 80000, replace=False)
            tp, sp = tms[idx], snd[idx]
        else:
            tp, sp = tms, snd
        ax.scatter(tp / 1000.0, sp, s=0.3, color='#264653', alpha=0.4)
        ax.axvline(train_time / 1000.0, color='red', ls='--', lw=1, alpha=0.6, label='Inizio test')
        ax.set_xlabel('Tempo (s)')
        ax.set_ylabel(f'ID neurone {pop_id}')
        ax.set_title(f'Raster: {pop_id} (n={n_neu})')
        ax.legend(fontsize=7)
        fig.tight_layout()
        _upload(fig, f'{pop_id}_raster.png')

        # PSTH (population mean firing rate)
        tb, rt = _bin_rates(tms, n_neu, 0, total_time, bin_ms=50.0)
        fig, ax = plt.subplots(figsize=(16, 4))
        ax.plot(tb / 1000.0, rt, color='#2a9d8f', lw=0.8)
        ax.axvline(train_time / 1000.0, color='red', ls='--', lw=1, alpha=0.6)
        ax.set_xlabel('Tempo (s)')
        ax.set_ylabel('Hz per neurone')
        ax.set_title(f'Frequenza media: {pop_id}')
        fig.tight_layout()
        _upload(fig, f'{pop_id}_histogram.png')

    # ── Metrics JSON ─────────────────────────────────────────────
    progress_cb(96, "Salvataggio delle metriche")

    metrics = {
        'experiment': 'cerebellar_conditioning',
        'n_train': n_train,
        'n_test_per_condition': n_test,
        'accuracy_pct': accuracy,
        'outcomes': outcomes,
        'median_rt_ms': median_rt,
        'weight_stats': weight_stats,
        'rt_by_condition': {
            lbl: [None if np.isnan(r) else float(r) for r in rts]
            for lbl, rts in rt_by_cond.items()
        },
        'trial_results': trial_results,
        'network_params': {k: v for k, v in par.items()},
        'train_modality_sequence': train_modality,
        'train_side_sequence': train_side_seq,
        'test_sequence': test_sequence,
    }

    store.put_json('experiment_metrics.json', metrics)
    store.put_json('spikes.json', {
        'metadata': {'simulation_id': sim_id, 'total_ms': total_time, 'train_end_ms': train_time},
        'spikes': {
            'DCN_A': {'senders': snd_a.tolist(), 'times': t_a.tolist()},
            'DCN_B': {'senders': snd_b.tolist(), 'times': t_b.tolist()},
            'PC': {'senders': snd_pc.tolist(), 'times': t_pc.tolist()},
            'IO': {'senders': snd_io.tolist(), 'times': t_io.tolist()},
        },
    }, in_zip=False)
    store.close()

    progress_cb(100, "Completata")
    gc.collect()
    return metrics
