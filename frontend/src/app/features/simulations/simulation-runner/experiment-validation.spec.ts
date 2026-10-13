import { describe, expect, it } from 'vitest';

import { Population } from '../../../core/models';
import { RunnerState, stateFromParams } from './experiment-params';
import { BUILTIN_META, FieldMeta, ValidationContext, fieldError, validateState } from './experiment-validation';

const population = (id: string, neuron_model = 'iaf_cond_exp', size = 100): Population => ({ id, size, neuron_model, params: {} });

/** Le popolazioni che l'esperimento multisensoriale richiede: PC_B non è tra queste. */
const MSI_NETWORK = ['GR', 'PC_A', 'IO_A', 'DCN_A', 'DCN_B'].map((id) => population(id));
const context = (populations: Population[]): ValidationContext => ({ populations, stimuli: [] });

const INPUTS = {
  devices: [{ id: 'S_A', model: 'legacy_sensory_stimulus', params: { rate: 30, n_sources: 20 } }],
  connections: [
    { source: 'S_A', target: 'GR', rule: 'fixed_indegree', synapse_model: 'static_synapse', params: { indegree: 2, weight: 1.2, delay: 1 } },
  ],
};
const PLOTS = [{ pop_a: 'DCN_A', pop_b: 'DCN_B', label: '' }];

const trials = (): RunnerState =>
  stateFromParams({
    resolution: 0.1,
    seed: 7,
    protocol: {
      num_trials: 16,
      trial_duration_ms: 600,
      stimulus_duration_ms: 400,
      iti_ms: 200,
      stimuli_pool: [{ devices: ['S_A'], weight: 1, condition_label: 'A', expected_winner: 'DCN_A' }],
    },
    inputs: INPUTS,
    analysis: { differential_plots: PLOTS },
  });

const continuous = (): RunnerState =>
  stateFromParams({
    resolution: 0.1,
    seed: 7,
    phases: { train_duration_ms: 0, test_duration_ms: 500 },
    inputs: INPUTS,
    analysis: { differential_plots: PLOTS },
  });

describe('validateState', () => {
  it('accepts a valid state in each mode', () => {
    expect(validateState(stateFromParams(), context(MSI_NETWORK))).toEqual([]);
    expect(trials().mode).toBe('trials');
    expect(validateState(trials(), context(MSI_NETWORK))).toEqual([]);
    expect(continuous().mode).toBe('continuous');
    expect(validateState(continuous(), context(MSI_NETWORK))).toEqual([]);
  });

  it('blocks a predefined experiment on a network without the required populations', () => {
    const errors = validateState(stateFromParams(), context([population('GR'), population('PC_A')]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('IO_A, DCN_A, DCN_B');
  });

  it('blocks a trial protocol without conditions', () => {
    const state = trials();
    state.trials.conditions = [];
    expect(validateState(state, context(MSI_NETWORK))).toEqual(['Aggiungi almeno una condizione.']);
  });

  it('blocks a continuous simulation longer than the maximum', () => {
    const state = continuous();
    state.continuous.test_duration_ms = 40_000_000;
    expect(validateState(state, context(MSI_NETWORK))).toEqual([
      'Il tempo biologico (40.000 s) supera il massimo di 3600 s per simulazione.',
    ]);
  });

  it('ignores the drafts of the inactive modes', () => {
    const state = trials();
    state.continuous.test_duration_ms = null;
    state.builtinDrafts.cerebellum_msi_race['seed'] = null;
    expect(validateState(state, context(MSI_NETWORK))).toEqual([]);
  });

  it('blocks the launch while the extra parameters are not valid JSON, naming where', () => {
    const state = trials();
    state.trials.inputs.devices[0].invalidExtra = '{"start": ';
    state.trials.inputs.connections[0].invalidExtra = '[1]';
    expect(validateState(state, context(MSI_NETWORK))).toEqual([
      'Dispositivo S_A: gli altri parametri non sono un oggetto JSON valido.',
      'Connessione 1: gli altri parametri non sono un oggetto JSON valido.',
    ]);
  });

  it('rejects populations that are stimulus sources as pair members and as connection targets', () => {
    const network = [...MSI_NETWORK, population('NOISE', 'poisson_generator')];
    const state = continuous();
    expect(validateState(state, context(network))).toEqual([]);
    state.continuous.inputs.connections[0].target = 'NOISE';
    state.continuous.differential_plots[0].pop_b = 'NOISE';
    expect(validateState(state, context(network))).toEqual([
      'Connessione 1: la popolazione NOISE è una sorgente di stimolo: scegli una popolazione di neuroni.',
      'Coppia 1: scegli le due popolazioni.',
    ]);
  });
});

describe('fieldError', () => {
  const count: FieldMeta = { label: 'Trial', min: 1, integer: true };

  it('requires a finite number', () => {
    expect(fieldError(count, null)).toBe('Valore obbligatorio.');
    expect(fieldError(count, Number.NaN)).toBe('Valore obbligatorio.');
    expect(fieldError(count, '3')).toBe('Valore obbligatorio.');
    expect(fieldError(count, 3)).toBeNull();
  });

  it('checks integers and bounds, writing numbers the Italian way', () => {
    expect(fieldError(count, 1.5)).toBe('Deve essere un numero intero.');
    expect(fieldError(count, 0)).toBe('Il minimo è 1.');
    expect(fieldError({ label: 'Ritardo', min: 0, exclusive: true }, 0)).toBe('Deve essere maggiore di 0.');
    expect(fieldError({ label: 'Passo', min: 0.1 }, 0.05)).toBe('Il minimo è 0,1.');
    expect(fieldError({ label: 'p', min: 0, exclusive: true, max: 1 }, 1)).toBeNull();
    expect(fieldError({ label: 'p', max: 0.5 }, 0.75)).toBe('Il massimo è 0,5.');
  });

  it('checks closed choices and free text', () => {
    const modality = BUILTIN_META.decision_making['modality'];
    for (const value of ['auditory', 'visual', 'audiovisual', 'dual']) expect(fieldError(modality, value)).toBeNull();
    expect(fieldError(modality, 'tactile')).toBe('Scegli un valore.');
    expect(fieldError({ label: 'Nome', text: true }, '  ')).toBe('Valore obbligatorio.');
    expect(fieldError({ label: 'Nome', text: true }, 'x')).toBeNull();
  });
});
