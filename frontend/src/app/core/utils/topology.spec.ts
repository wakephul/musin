import { describe, expect, it } from 'vitest';

import { countNeurons, countSynapses } from './topology';

const populations = [
  { id: 'GR', size: 2000 },
  { id: 'PC', size: 100 },
  { id: 'DCN', size: 50 },
];

describe('topology', () => {
  it('sums population sizes', () => {
    expect(countNeurons(populations)).toBe(2150);
    expect(countNeurons(null)).toBe(0);
  });

  it('reads indegree, outdegree and p from params', () => {
    const projection = (rule: string, params: Record<string, unknown>) => [{ source: 'GR', target: 'PC', rule, params }];
    expect(countSynapses(populations, projection('fixed_indegree', { indegree: 160 }))).toBe(16000);
    expect(countSynapses(populations, projection('fixed_outdegree', { outdegree: 2 }))).toBe(4000);
    expect(countSynapses(populations, projection('pairwise_bernoulli', { p: 0.1 }))).toBe(20000);
    expect(countSynapses(populations, projection('one_to_one', {}))).toBe(100);
    expect(countSynapses(populations, projection('all_to_all', {}))).toBe(200000);
  });
});
