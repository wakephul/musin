import pytest

from backend.services.experiments import ExperimentParamsError, estimate_duration_ms, experiment_kind


POOL = [{"devices": [], "condition_label": "catch"}]


@pytest.mark.parametrize("params, kind", [
    ({"builtin": "cerebellum_msi_race"}, "cerebellum_msi_race"),
    ({"builtin": "cerebellum_conditioning"}, "cerebellum_conditioning"),
    ({"builtin": "decision_making"}, "decision_making"),
    ({"protocol": {"num_trials": 3}}, "trial_protocol"),
    ({"phases": {"test_duration_ms": 10}}, "continuous"),
    ({}, "continuous"),
])
def test_experiment_kind(params, kind):
    assert experiment_kind(params) == kind


@pytest.mark.parametrize("params, expected_ms", [
    ({"phases": {"train_duration_ms": 200, "test_duration_ms": 300}}, 500),
    ({"phases": {"test_duration_ms": 300}}, 300),                 # senza addestramento non raddoppia
    ({"protocol": {"num_trials": 4, "trial_duration_ms": 500, "iti_ms": 100, "stimuli_pool": POOL}}, 2400),
    ({"protocol": {"num_trials": 4, "trial_duration_ms": 500, "iti_range_ms": [100, 300], "stimuli_pool": POOL}}, 3200),
    ({"builtin": "cerebellum_conditioning", "n_train": 2, "n_test": 1}, 15000),
    ({"builtin": "decision_making", "decision_making": {"num_trials": 2}}, 12000),            # due reti
    ({"builtin": "decision_making", "decision_making": {"num_trials": 2, "modality": "visual"}}, 6000),
    ({"builtin": "cerebellum_msi_race",
      "train": {"n_trials": 1, "trial_duration_ms": 1000, "iti_range_ms": [0, 500]},
      "test": {"n_trials": 2, "trial_duration_ms": 1000, "iti_range_ms": [0, 100]}}, 3700),
])
def test_estimate_duration(params, expected_ms):
    assert estimate_duration_ms(params) == expected_ms


@pytest.mark.parametrize("params", [
    {"builtin": "unknown"},
    {"protocol": {"num_trials": "x"}},
    {"protocol": {"num_trials": 2.5}},
    {"protocol": [1]},
    {"builtin": "cerebellum_msi_race", "train": {"iti_range_ms": [1]}},
    {"builtin": "cerebellum_msi_race", "test": {"iti_range_ms": [500, 100]}},
    # Una durata negativa compensava un'altra enorme e passava il tetto di un'ora.
    {"phases": {"train_duration_ms": -1e12, "test_duration_ms": 1000000001000}},
    {"protocol": {"num_trials": 1, "stimulus_duration_ms": -1e12}},
    {"protocol": {"num_trials": 2, "trial_duration_ms": 100, "stimulus_duration_ms": 500}},
    # Un protocollo senza condizioni, o con un dispositivo che non esiste, girerebbe a vuoto.
    {"protocol": {"num_trials": 2}},
    {"protocol": {"num_trials": 2, "stimuli_pool": []}},
    {"protocol": {"num_trials": 2, "stimuli_pool": [{"devices": ["S"]}]}},
    {"protocol": {"num_trials": 2, "stimuli_pool": [{"devices": [], "weight": 0}]}},
    {"phases": {"test_duration_ms": float("nan")}},
    {"phases": {"test_duration_ms": float("inf")}},
    # Dimensioni che esaurirebbero la memoria del worker.
    {"builtin": "decision_making", "decision_making": {"order": 10**6}},
    {"builtin": "cerebellum_conditioning", "GR_num": 10**9},
    {"phases": {"test_duration_ms": 10}, "inputs": {"devices": [{"id": "S", "model": "legacy_sensory_stimulus", "params": {"n_sources": 10**8}}]}},
])
def test_invalid_params_raise_a_readable_error(params):
    with pytest.raises(ExperimentParamsError):
        estimate_duration_ms(params)
