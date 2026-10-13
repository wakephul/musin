import { describe, expect, it } from 'vitest';

import { CONDITIONING_DEFAULTS, DECISION_MAKING_DEFAULTS, MSI_RACE_DEFAULTS } from '../../../core/data/protocol-presets';
import {
  BUILTIN_KINDS,
  buildParams,
  estimateDurationMs,
  experimentKind,
  inheritedParams,
  stateFromParams,
} from './experiment-params';

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

  it('keeps the parameters that the forms do not show when relaunching a simulation', () => {
    // Regressione: le chiavi estranee ai default sparivano e la nuova simulazione tornava ai valori predefiniti.
    const msi = { ...MSI_RACE_DEFAULTS, train: { ...MSI_RACE_DEFAULTS.train, us_window_ms: [250, 500] } };
    const conditioning = { ...CONDITIONING_DEFAULTS, GR_num: 1000, PC_num: 50 };
    const decision = {
      ...DECISION_MAKING_DEFAULTS,
      decision_making: { ...DECISION_MAKING_DEFAULTS.decision_making, bin_size_ms: 2 },
      network_overrides: { w_plus: 1.7 },
    };
    for (const params of [msi, conditioning, decision]) expect(buildParams(stateFromParams(params))).toEqual(params);

    const draft = stateFromParams(decision).builtinDrafts.decision_making;
    // La bozza non condivide oggetti con i parametri di partenza.
    expect(draft['network_overrides']).not.toBe(decision.network_overrides);
    expect(inheritedParams('decision_making', draft)).toEqual([
      'decision_making.bin_size_ms = 2',
      'network_overrides = {"w_plus":1.7}',
    ]);
    expect(inheritedParams('cerebellum_msi_race', stateFromParams(msi).builtinDrafts.cerebellum_msi_race)).toEqual([
      'train.us_window_ms = [250,500]',
    ]);
    expect(inheritedParams('cerebellum_conditioning', stateFromParams(conditioning).builtinDrafts.cerebellum_conditioning)).toEqual([
      'GR_num = 1000',
      'PC_num = 50',
    ]);
  });

  it('adds nothing to a form that does not start from a previous simulation', () => {
    const defaults = {
      cerebellum_msi_race: MSI_RACE_DEFAULTS,
      cerebellum_conditioning: CONDITIONING_DEFAULTS,
      decision_making: DECISION_MAKING_DEFAULTS,
    };
    const state = stateFromParams();
    for (const kind of BUILTIN_KINDS) {
      state.builtin = kind;
      expect(buildParams(state)).toEqual(defaults[kind]);
      expect(inheritedParams(kind, state.builtinDrafts[kind])).toEqual([]);
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
    expect(estimateDurationMs(CONDITIONING_DEFAULTS)).toBe((15 + 3 * 30) * 3000);
    expect(estimateDurationMs(DECISION_MAKING_DEFAULTS)).toBe(2 * 12 * 3000);   // due reti
    expect(estimateDurationMs({ builtin: 'decision_making', decision_making: { modality: 'visual', trial_slot_ms: 3000, num_trials: 12 } })).toBe(12 * 3000);
    expect(estimateDurationMs(MSI_RACE_DEFAULTS)).toBe(45 * (1000 + 1000) + 100 * (1000 + 400));
    expect(estimateDurationMs(TRIALS)).toBe(16 * (600 + 400));
    expect(estimateDurationMs({ phases: { train_duration_ms: 0, test_duration_ms: 500 } })).toBe(500);
  });
});
