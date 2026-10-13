import { describe, expect, it } from 'vitest';

import { pairRaceModel } from './results-helpers';

const stats = (population: string) => ({ population, n_V: 1, n_A: 1, n_AV: 1, max_rmi_violation: 0.5, has_facilitation: true });

describe('pairRaceModel', () => {
  it('matches graphs and statistics by population', () => {
    const entries = pairRaceModel(
      [{ population: 'DCN_A', url: 'a.png' }, { population: 'DCN_B', url: 'b.png' }],
      [stats('DCN_B'), stats('DCN_A')],
    );
    expect(entries.map((entry) => [entry.population, entry.url, entry.stats?.population])).toEqual([
      ['DCN_A', 'a.png', 'DCN_A'],
      ['DCN_B', 'b.png', 'DCN_B'],
    ]);
  });

  it('pairs a single graph with a single result even when the names differ', () => {
    // Le simulazioni vecchie scrivevano un nome descrittivo nel JSON.
    const [entry] = pairRaceModel([{ population: 'DCN_A', url: 'a.png' }], [stats('DCN (race: first of DCN_A/DCN_B)')]);
    expect(entry.url).toBe('a.png');
    expect(entry.stats?.has_facilitation).toBe(true);
  });

  it('keeps results that have no graph', () => {
    expect(pairRaceModel([], [stats('DCN_A')])).toEqual([{ population: 'DCN_A', url: null, stats: stats('DCN_A') }]);
  });
});
