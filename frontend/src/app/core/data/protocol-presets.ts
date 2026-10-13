/** Parametri di partenza degli esperimenti predefiniti (stessa forma di `experiment_params`). */

/** Le stesse che il simulatore pretende (worker/networks/cerebellum_msi_race.py). */
export const MSI_REQUIRED_POPULATIONS = ['GR', 'PC_A', 'IO_A', 'DCN_A', 'DCN_B'];

export const MSI_RACE_DEFAULTS = {
  builtin: 'cerebellum_msi_race',
  seed: 2016,
  resolution: 0.1,
  train: {
    n_trials: 45,
    trial_duration_ms: 1000,
    stimulus_duration_ms: 600,
    iti_range_ms: [500, 1000],
    us_rate: 8.5,
    us_n_sources: 10,
  },
  test: {
    n_trials: 100,
    trial_duration_ms: 1000,
    stimulus_duration_ms: 600,
    iti_range_ms: [200, 400],
    vis_rate: 20.0,
    aud_rate: 20.0,
    n_sources: 20,
    aud_latency_ms: 180,
    vis_latency_ms: 220,
    mf_dcn_weight_low: 0.34,
    mf_dcn_weight_high: 0.4,
    response: { bin_ms: 5.0, smooth_bins: 5, baseline_ms: 200.0, threshold_delta_hz: 15.0 },
  },
};

export const CONDITIONING_DEFAULTS = {
  builtin: 'cerebellum_conditioning',
  seed: 1234,
  n_train: 15,
  n_test: 30,
  aud_latency_ms: 150,
  vis_latency_ms: 220,
  rt_smooth_bins: 5,
};

export const DECISION_MAKING_DEFAULTS = {
  builtin: 'decision_making',
  decision_making: {
    modality: 'dual',
    num_trials: 12,
    rate: 30.0,
    number_of_neurons: 80,
    stimulus_window_ms: 600.0,
    trial_slot_ms: 3000.0,
    threshold: 15.0,
    rt_smooth_bins: 5,
    auditory_latency_ms: 150,
    visual_latency_ms: 220,
    seed: 1234,
    order: 400,
  },
};
