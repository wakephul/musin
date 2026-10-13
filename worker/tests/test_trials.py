import numpy as np

from worker.networks.cerebellum_msi_race import adapt_legacy_topology, make_windows
from worker.networks.generic import Trial, build_trials, decision_metrics, stimulus_spike_trains

PROTOCOL = {
    "num_trials": 40,
    "trial_duration_ms": 600,
    "stimulus_duration_ms": 400,
    "iti_range_ms": [200, 400],
    "stimuli_pool": [
        {"devices": ["S_A"], "weight": 1, "condition_label": "A", "expected_winner": "DCN_A"},
        {"devices": [], "weight": 1, "condition_label": "catch", "expected_winner": None},
    ],
}


def test_build_trials_follows_the_protocol_and_the_seed():
    trials = build_trials(PROTOCOL, np.random.default_rng(5), 0.1)
    assert trials == build_trials(PROTOCOL, np.random.default_rng(5), 0.1)
    assert len(trials) == 40
    assert {trial.label for trial in trials} == {"A", "catch"}
    for previous, trial in zip(trials, trials[1:]):
        assert round(trial.stim_end - trial.start, 6) == 400
        assert round(trial.end - trial.start, 6) == 600
        assert 200 <= previous.iti <= 400
        assert trial.start == round(previous.end + previous.iti, 6)
        assert abs(trial.start * 10 - round(trial.start * 10)) < 1e-6   # sulla griglia da 0,1 ms
    assert all(trial.devices == ["S_A"] and trial.expected_winner == "DCN_A" for trial in trials if trial.label == "A")


def test_sensory_stimulus_fires_only_in_the_trials_where_it_is_active():
    trials = build_trials(PROTOCOL, np.random.default_rng(5), 0.1)
    device = {"id": "S_A", "model": "legacy_sensory_stimulus", "params": {"rate": 100.0, "n_sources": 5}}
    trains = stimulus_spike_trains(device, trials, trials[-1].end, np.random.default_rng(1), 0.1, load_stimulus=None)
    active = [(t.start, t.stim_end) for t in trials if "S_A" in t.devices]
    spikes = np.concatenate(trains)
    assert len(trains) == 5 and len(spikes) > 0
    assert all(any(start < spike <= end for start, end in active) for spike in spikes)


def test_recorded_stimulus_is_replayed_from_each_active_trial_onset():
    trials = [Trial(0.0, 100.0, 200.0, 0.0, ["REC"]), Trial(200.0, 300.0, 400.0, 0.0, []), Trial(400.0, 500.0, 600.0, 0.0, ["REC"])]
    device = {"id": "REC", "model": "spike_train_stimulus", "params": {"stimulus_id": 7}}
    trains = stimulus_spike_trains(device, trials, 600.0, np.random.default_rng(0), 0.1,
                                   load_stimulus=lambda stimulus_id: [[10.0, 50.0, 150.0], [20.0]])
    # 150 ms cade oltre la finestra di stimolo (100 ms) e non viene riprodotto.
    assert trains == [[10.0, 50.0, 410.0, 450.0], [20.0, 420.0]]


def test_decision_metrics_count_only_trials_with_an_expected_winner():
    trials = [
        Trial(0.0, 50.0, 100.0, 0.0, ["S_A"], "A", "DCN_A"),
        Trial(100.0, 150.0, 200.0, 0.0, ["S_B"], "B", "DCN_B"),
        Trial(200.0, 250.0, 300.0, 0.0, [], "catch", None),
    ]
    spikes = {"DCN_A": {"times": [10.0, 20.0, 130.0, 140.0]}, "DCN_B": {"times": [150.0]}}
    metric = decision_metrics("DCN_A", "DCN_B", spikes, trials, margin=0)
    assert (metric["correct_trials"], metric["total_valid_trials"], metric["accuracy_percent"]) == (1, 2, 50.0)
    assert [row["is_correct"] for row in metric["trial_details"]] == [True, False, None]
    assert [row["actual_winner"] for row in metric["trial_details"]] == ["DCN_A", "DCN_A", "none"]


def test_msi_windows_are_consecutive_and_on_the_grid():
    windows, end = make_windows(5, 1000.0, 600.0, [200, 400], np.random.default_rng(2), 0.1, t_start=50.0)
    assert windows[0] == (50.0, 650.0, 1050.0)
    for (_, _, previous_end), (start, _, _) in zip(windows, windows[1:]):
        assert 200 <= start - previous_end <= 400
    assert end >= windows[-1][2] + 200


def test_legacy_eglif_networks_are_adapted_and_new_ones_left_alone():
    legacy = {
        "populations": [
            {"id": "GR", "size": 10, "neuron_model": "iaf_cond_exp", "params": {"C_m": 2.0}},
            {"id": "PC_A", "size": 2, "neuron_model": "eglif_pc_nestml", "params": {}},
            {"id": "IO_A", "size": 2, "neuron_model": "eglif_io_nestml", "params": {}},
            {"id": "DCN_A", "size": 1, "neuron_model": "eglif_dcnp", "params": {}},
        ],
        "projections": [
            {"source": "GR", "target": "PC_A", "rule": "fixed_indegree", "synapse_model": "stdp_synapse_sinexp",
             "params": {"indegree": 8, "weight": 4.0, "receptor_type": 1, "A_minus": 0.02}},
            {"source": "IO_A", "target": "PC_A", "rule": "one_to_one", "synapse_model": "static_synapse",
             "params": {"weight": 1.0, "receptor_type": 5}},
            {"source": "PC_A", "target": "DCN_A", "rule": "fixed_outdegree", "synapse_model": "static_synapse",
             "params": {"outdegree": 1, "weight": -10.0, "receptor_type": 3}},
        ],
    }
    adapted, changed = adapt_legacy_topology(legacy)
    assert changed
    assert [pop["neuron_model"] for pop in adapted["populations"]] == ["iaf_cond_exp", "iaf_cond_exp", "parrot_neuron", "iaf_cond_exp"]
    assert adapted["populations"][0]["params"] == {"C_m": 2.0}
    assert [(p["source"], p["synapse_model"], p["params"]) for p in adapted["projections"]] == [
        ("GR", "static_synapse", {"indegree": 8, "weight": 4.0}),
        ("PC_A", "static_synapse", {"outdegree": 1, "weight": -20.0, "delay": 1.0}),
    ]

    modern = {"populations": [{"id": "GR", "size": 1, "neuron_model": "iaf_cond_exp", "params": {}}], "projections": []}
    assert adapt_legacy_topology(modern) == (modern, False)
