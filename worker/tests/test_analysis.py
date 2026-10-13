import numpy as np
import pytest

from worker.analysis import (
    binned_rate, cf_gated_ltd, decide, ecdf, first_crossing, first_upward_crossing,
    poisson_trains, race_model_inequality, snap, trailing_mean,
)


def test_snap_puts_times_on_the_kernel_grid():
    assert snap(300.00000000006, 0.1) == 300.0
    assert snap(1234.567, 0.1) == 1234.6
    assert snap(1234.567, 0.5) == 1234.5
    assert snap(7.3, 1.0) == 7.0


def test_poisson_trains_stay_in_the_window_on_the_grid_and_are_reproducible():
    trains = poisson_trains(np.random.default_rng(1), 50.0, 20, 1000.0, 1600.0, resolution=0.1)
    again = poisson_trains(np.random.default_rng(1), 50.0, 20, 1000.0, 1600.0, resolution=0.1)
    assert trains == again
    spikes = np.concatenate(trains)
    assert spikes.min() > 1000.0 and spikes.max() <= 1600.0
    assert np.allclose(spikes * 10, np.round(spikes * 10))
    assert all(train == sorted(set(train)) for train in trains)
    # 50 Hz × 0,6 s × 20 sorgenti = 600 spike attesi
    assert 500 < len(spikes) < 700


def test_poisson_trains_with_nothing_to_generate():
    rng = np.random.default_rng(0)
    assert poisson_trains(rng, 0.0, 3, 0.0, 100.0) == [[], [], []]
    assert poisson_trains(rng, 20.0, 2, 100.0, 100.0) == [[], []]


def test_binned_rate_is_per_neuron_in_hz():
    starts, rate = binned_rate([1.0, 2.0, 11.0], n_neurons=2, bin_ms=10.0, total_ms=30.0)
    assert starts.tolist() == [0.0, 10.0, 20.0]
    assert rate.tolist() == [100.0, 50.0, 0.0]


def test_trailing_mean_never_reacts_before_the_input():
    smoothed = trailing_mean([0, 0, 0, 10, 10, 10], window=2)
    assert smoothed.tolist() == [0, 0, 0, 5, 10, 10]


def test_first_crossing_respects_the_window():
    starts = np.arange(0.0, 100.0, 10.0)
    values = np.array([0, 20, 0, 0, 0, 20, 20, 0, 0, 0])
    assert first_crossing(starts, values, 15, 0, 100) == 10.0
    assert first_crossing(starts, values, 15, 20, 100) == 50.0
    assert first_crossing(starts, values, 15, 70, 100) is None


def test_upward_crossing_ignores_activity_left_over_from_before():
    starts = np.arange(0.0, 80.0, 10.0)
    carried_over = np.array([20, 20, 20, 20, 0, 0, 20, 20])
    assert first_crossing(starts, carried_over, 15, 20, 80) == 20.0
    assert first_upward_crossing(starts, carried_over, 15, 20, 80) == 60.0
    assert first_upward_crossing(starts, np.full(8, 20), 15, 20, 80) is None


def test_ecdf_counts_missed_trials_in_the_denominator():
    assert ecdf([100, 200], [50, 100, 250], n_trials=4).tolist() == [0.0, 0.25, 0.5]


def test_race_model_inequality_flags_coactivation_but_not_a_race():
    rng = np.random.default_rng(3)
    visual, auditory = rng.normal(320, 30, 400), rng.normal(300, 30, 400)
    # Race model: la risposta bimodale è la più veloce dei due canali indipendenti.
    race = np.minimum(rng.normal(320, 30, 400), rng.normal(300, 30, 400))
    assert race_model_inequality(visual, auditory, race, 400, 400, 400)["max_violation"] < 0.05
    # Coattivazione: risposte bimodali più veloci di quanto un race possa produrre.
    coactivation = rng.normal(220, 20, 400)
    result = race_model_inequality(visual, auditory, coactivation, 400, 400, 400)
    assert result["max_violation"] > 0.5
    assert np.all(result["bound"] <= 1.0)


def test_decide_uses_the_margin():
    assert decide(12, 3, "A", "B") == "A"
    assert decide(3, 12, "A", "B") == "B"
    assert decide(5, 5, "A", "B") == "none"
    assert decide(12, 3, "A", "B", margin=10) == "none"


def test_cf_gated_ltd_depresses_only_flagged_synapses_within_bounds():
    weights = np.array([4.0, 4.0, 1.0, 5.9995])
    depress = np.array([True, False, True, False])
    updated = cf_gated_ltd(weights, depress, ltd=1.5, ltp=0.001, w_min=0.0, w_max=6.0)
    assert updated.tolist() == pytest.approx([2.5, 4.001, 0.0, 6.0])
