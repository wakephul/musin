import { describe, expect, it } from 'vitest';

import { NETWORK_PRESETS, presetToPayload } from '../../../core/data/network-presets';
import { NetworkPayload } from '../../../core/models';
import { toFormValue, toPayload, validate } from './network-form.mapping';

/** Rete salvata prima della correzione: STDP, receptor_type e degree dentro params. */
const LEGACY: NetworkPayload = {
  name: 'Cerebellar Microcircuit (A/B)',
  description: 'legacy',
  nodes_count: 2100,
  edges_count: 16100,
  params: {},
  topology: {
    populations: [
      { id: 'GR', size: 2000, neuron_model: 'iaf_cond_exp', params: { C_m: 2, V_th: -40 } },
      { id: 'PC_A', size: 100, neuron_model: 'eglif_pc_nestml', params: {} },
    ],
    projections: [
      {
        source: 'GR',
        target: 'PC_A',
        rule: 'fixed_indegree',
        synapse_model: 'stdp_synapse_sinexp',
        params: { A_plus: 0.001, weight: 4, A_minus: 0.02, indegree: 160, receptor_type: 1 },
      },
      { source: 'PC_A', target: 'PC_A', rule: 'one_to_one', synapse_model: 'static_synapse', params: { weight: { distribution: 'uniform', low: 0.5, high: 1 } } },
      { source: 'GR', target: 'PC_A', rule: 'pairwise_bernoulli', synapse_model: 'static_synapse', params: { p: 0.25, weight: -1.5, delay: 2 } },
    ],
  },
};

describe('network form mapping', () => {
  it('loading and saving an untouched network returns the same topology', () => {
    for (const payload of [LEGACY, presetToPayload(NETWORK_PRESETS[0])]) {
      const saved = toPayload(toFormValue(payload), payload.params);
      expect(saved.topology).toEqual(payload.topology);
      expect(saved.name).toBe(payload.name);
    }
  });

  it('keeps connection degrees inside params', () => {
    const [indegree, , bernoulli] = toPayload(toFormValue(LEGACY)).topology.projections;
    expect(indegree.params['indegree']).toBe(160);
    expect(bernoulli.params['p']).toBe(0.25);
    expect(indegree).not.toHaveProperty('indegree');
  });

  it('moves degree, weight and delay to dedicated fields and leaves the rest as JSON', () => {
    const [indegree, distribution] = toFormValue(LEGACY).projections;
    expect(indegree.degree).toBe(160);
    expect(indegree.weight).toBe(4);
    expect(JSON.parse(indegree.extra)).toEqual({ A_plus: 0.001, A_minus: 0.02, receptor_type: 1 });
    // Un peso non numerico resta nel JSON.
    expect(distribution.weight).toBeNull();
    expect(JSON.parse(distribution.extra)).toEqual({ weight: { distribution: 'uniform', low: 0.5, high: 1 } });
  });

  it('recomputes neuron and synapse counts on save', () => {
    const saved = toPayload(toFormValue(LEGACY));
    expect(saved.nodes_count).toBe(2100);
    expect(saved.edges_count).toBe(160 * 100 + 100 + 0.25 * 2000 * 100);
  });

  it('reports duplicated ids and accepts the presets', () => {
    expect(validate(toFormValue(presetToPayload(NETWORK_PRESETS[0]))).first).toBeNull();
    const duplicated = toFormValue(LEGACY);
    duplicated.populations[1].id = 'GR';
    expect(validate(duplicated).first).not.toBeNull();
  });
});
