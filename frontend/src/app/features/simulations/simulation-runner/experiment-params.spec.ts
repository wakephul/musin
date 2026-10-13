import { describe, expect, it } from 'vitest';

import { CONDITIONING_DEFAULTS, DECISION_MAKING_DEFAULTS, MSI_RACE_DEFAULTS } from '../../../core/data/protocol-presets';
import { buildParams, estimateDurationMs, experimentKind, stateFromParams } from './experiment-params';

const TRIALS = {
  resolution: 0.1,
  seed: 7,
  protocol: {
    num_trials: 16,
    trial_duration_ms: 600,
    stimulus_duration_ms: 400,
    iti_range_ms: [200, 400],
    stimuli_pool: [
      { devices: ['S_A'], weight: 1, condition_label: 'A', expected_winner: 'DCN_A' },
      { devices: [], weight: 0.4, condition_label: 'catch', expected_winner: null },
    ],
  },
  inputs: {
    devices: [{ id: 'S_A', model: 'legacy_sensory_stimulus', params: { rate: 30, n_sources: 20 } }],
    connections: [
      { source: 'S_A', target: 'GR', rule: 'fixed_indegree', synapse_model: 'static_synapse', params: { indegree: 2, weight: 1.2, delay: 1 } },
    ],
  },
  analysis: {
    differential_plots: [{ pop_a: 'DCN_A', pop_b: 'DCN_B', label: 'Uscita' }],
    decision_margin: 0,
    response_cdf: { enabled: true, threshold: 15, bin_size: 5 },
    race_model: { enabled: false, populations: [] },
  },
};

describe('experiment params', () => {
  it('opens on the multisensory experiment with its defaults', () => {
    expect(buildParams(stateFromParams())).toEqual(MSI_RACE_DEFAULTS);
  });

  it('round-trips the parameters of a previous simulation', () => {
    for (const params of [MSI_RACE_DEFAULTS, CONDITIONING_DEFAULTS, DECISION_MAKING_DEFAULTS, TRIALS]) {
      expect(buildParams(stateFromParams(params))).toEqual(params);
    }
  });

  it('builds the payload from the active mode only', () => {
    // Regressione: una chiave `builtin` rimasta da un preset faceva partire l'esperimento sbagliato.
    const state = stateFromParams(MSI_RACE_DEFAULTS);
    state.mode = 'trials';
    const trials = buildParams(state);
    expect(trials).not.toHaveProperty('builtin');
    expect(experimentKind(trials)).toBe('trial_protocol');

    state.mode = 'continuous';
    const continuous = buildParams(state);
    expect(continuous).not.toHaveProperty('builtin');
    expect(continuous).not.toHaveProperty('protocol');
    // Senza addestramento la durata va dichiarata a zero, non omessa.
    expect(continuous['phases']['train_duration_ms']).toBe(0);
  });

  it('estimates duration like the backend', () => {
    expect(estimateDurationMs(CONDITIONING_DEFAULTS)).toBe((20 + 3 * 20) * 3000);
    expect(estimateDurationMs(DECISION_MAKING_DEFAULTS)).toBe(12 * 3000);
    expect(estimateDurationMs(MSI_RACE_DEFAULTS)).toBe(45 * (1000 + 1000) + 100 * (1000 + 400));
    expect(estimateDurationMs(TRIALS)).toBe(16 * (600 + 400));
    expect(estimateDurationMs({ phases: { train_duration_ms: 0, test_duration_ms: 500 } })).toBe(500);
  });
});
