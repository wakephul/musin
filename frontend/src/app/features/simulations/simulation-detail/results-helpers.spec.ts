import { describe, expect, it } from 'vitest';

import { ResponseGraph } from '../../../core/models';
import { buildResponseEntries, conditionLabel, pairRaceModel, winnerLabel } from './results-helpers';

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

describe('winnerLabel', () => {
  it('keeps population ids and writes the non-answers in words', () => {
    expect(winnerLabel('DCN_A')).toEqual({ text: 'DCN_A', isId: true });
    for (const winner of ['none', '', null, undefined]) {
      expect(winnerLabel(winner)).toEqual({ text: 'nessuna risposta', isId: false });
    }
    expect(winnerLabel('TIE')).toEqual({ text: 'pari', isId: false });
  });
});

describe('conditionLabel', () => {
  it('translates the modalities of the predefined experiments and leaves the other labels alone', () => {
    expect(conditionLabel('auditory')).toBe('Uditivo');
    expect(conditionLabel('dual')).toBe('Due reti (uditiva e visiva)');
    expect(conditionLabel('AV')).toBe('AV');
  });
});

describe('buildResponseEntries', () => {
  const graph = (pair: string, kind: ResponseGraph['kind'] = 'cdf'): ResponseGraph => ({ kind, pair, url: `${pair}-${kind}.png` });

  it('joins medians, counts and graphs of each pair', () => {
    const [entry] = buildResponseEntries(
      [{ pop_a: 'DCN_A', pop_b: 'DCN_B', label: 'Uscita', median_by_condition: { A: 212.5 }, count_by_condition: { A: 9, CATCH: 0 } }],
      [graph('DCN_A_DCN_B', 'activation'), graph('DCN_A_DCN_B'), graph('PC_A_PC_B')],
    );
    expect(entry.label).toBe('Uscita');
    expect(entry.graphs.map((item) => item.kind)).toEqual(['activation', 'cdf']);
    expect(entry.rows).toEqual([
      { condition: 'A', count: 9, median: 212.5 },
      { condition: 'CATCH', count: 0, median: null },
    ]);
  });

  it('names an entry after its pair when there is no label', () => {
    const [entry] = buildResponseEntries([{ pop_a: 'DCN_A', pop_b: 'DCN_B', count_by_condition: { A: 1 } }], []);
    expect(entry.label).toBe('DCN_A_DCN_B');
  });

  it('keeps graphs without statistics and drops entries with nothing to show', () => {
    const entries = buildResponseEntries([{ pop_a: 'train', pop_b: 'DCN_AB', label: 'Addestramento' }], [graph('PC_A_PC_B')]);
    expect(entries).toEqual([{ label: 'PC_A_PC_B', graphs: [graph('PC_A_PC_B')], rows: [] }]);
  });
});
