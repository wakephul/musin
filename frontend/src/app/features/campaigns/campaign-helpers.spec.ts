import { describe, expect, it } from 'vitest';

import { CONDITIONING_DEFAULTS } from '../../core/data/protocol-presets';
import { Campaign, CampaignGroup } from '../../core/models';
import {
  campaignState,
  chartSeries,
  countsText,
  differenceText,
  isActive,
  medianText,
  pText,
  seedsText,
  sweepLabel,
} from './campaign-helpers';

const counts = (changes: Partial<Campaign['counts']>) => ({
  PENDING: 0,
  RUNNING: 0,
  COMPLETED: 0,
  FAILED: 0,
  ABORTED: 0,
  ...changes,
});

describe('campaign helpers', () => {
  it('derives one state for the whole campaign', () => {
    expect(campaignState(counts({ PENDING: 3 })).label).toBe('In coda');
    expect(campaignState(counts({ PENDING: 2, RUNNING: 1 })).label).toBe('In corso');
    expect(campaignState(counts({ PENDING: 2, COMPLETED: 1 })).label).toBe('In corso');
    expect(campaignState(counts({ COMPLETED: 3 })).label).toBe('Completata');
    expect(campaignState(counts({ COMPLETED: 2, FAILED: 1 })).label).toBe('Completata in parte');
    expect(campaignState(counts({ FAILED: 2, ABORTED: 1 })).label).toBe('Fallita');
    expect(campaignState(counts({ ABORTED: 3 })).label).toBe('Interrotta');
    expect(isActive(counts({ COMPLETED: 3 }))).toBe(false);
    expect(isActive(counts({ COMPLETED: 2, PENDING: 1 }))).toBe(true);
  });

  it('writes counts, seeds and numbers the way the pages show them', () => {
    expect(countsText(counts({ COMPLETED: 8, RUNNING: 1, PENDING: 3 }))).toBe(
      '12 simulazioni: 8 completate, 1 in corso, 3 in coda',
    );
    expect(countsText(counts({ COMPLETED: 1, FAILED: 1 }))).toBe('2 simulazioni: 1 completata, 1 fallita');
    expect(seedsText([11, 12, 13])).toBe('11–13');
    expect(seedsText([11, 12])).toBe('11, 12');
    expect(seedsText([11, 14, 20])).toBe('11, 14, 20');
    expect(medianText(328, [305, 372.5])).toBe('328 (305–372,5)');
    expect(medianText(245, null)).toBe('245');
    expect(medianText(null, null)).toBe('nessuna risposta');
    expect(differenceText({ difference_ms: 8, ci95_ms: [-12, 28] })).toBe('+8 (−12 … +28)');
    expect(differenceText({ difference_ms: -50, ci95_ms: [-75, -22.5] })).toBe('−50 (−75 … −22,5)');
    expect(differenceText(null)).toBe('n.d.');
    expect(pText(0.0005)).toBe('p < 0,001');
    expect(pText(0.203)).toBe('p = 0,203');
  });

  it('names the swept parameter like the launch form, or by its path', () => {
    const campaign = {
      params: CONDITIONING_DEFAULTS,
      sweep: { path: 'aud_latency_ms', values: [150, 180] },
    } as unknown as Campaign;
    expect(sweepLabel(campaign)).toBe('Latenza uditiva (ms)');
    expect(sweepLabel({ ...campaign, sweep: { path: 'network_overrides.eta_ex', values: [1, 2] } })).toBe(
      'network_overrides.eta_ex',
    );
    expect(sweepLabel({ ...campaign, sweep: null })).toBeNull();
  });

  it('draws one curve per condition with enough responses, plus the reference ones', () => {
    const percentiles = [1, 2, 3];
    const group = {
      percentile_levels: [5, 50, 95],
      conditions: [
        { label: 'A', percentiles_ms: percentiles, reference: { percentiles_ms: percentiles } },
        { label: 'V', percentiles_ms: [], reference: { percentiles_ms: percentiles } },
        { label: 'AV', percentiles_ms: percentiles },
      ],
    } as unknown as CampaignGroup;
    expect(chartSeries(group).map((series) => [series.condition, series.reference])).toEqual([
      ['A', false],
      ['AV', false],
      ['A', true],
      ['V', true],
    ]);
  });
});
