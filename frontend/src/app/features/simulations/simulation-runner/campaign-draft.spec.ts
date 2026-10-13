import { describe, expect, it } from 'vitest';

import { CONDITIONING_DEFAULTS, DECISION_MAKING_DEFAULTS, MSI_RACE_DEFAULTS } from '../../../core/data/protocol-presets';
import {
  CUSTOM_PATH,
  campaignDurationMs,
  campaignMembers,
  emptyCampaign,
  isCampaign,
  parseValues,
  seedsOf,
  sweepOf,
  sweepOptions,
  validateCampaign,
} from './campaign-draft';
import { estimateDurationMs } from './experiment-params';

const draft = (changes: Partial<ReturnType<typeof emptyCampaign>>) => ({ ...emptyCampaign(), ...changes });

describe('campaign draft', () => {
  it('is a single launch until there is more than one seed or a swept parameter', () => {
    expect(isCampaign(emptyCampaign())).toBe(false);
    expect(isCampaign(draft({ repeats: 3 }))).toBe(true);
    expect(isCampaign(draft({ sweepPath: 'aud_latency_ms' }))).toBe(true);
    expect(validateCampaign(CONDITIONING_DEFAULTS, emptyCampaign())).toEqual([]);
  });

  it('uses consecutive seeds from the one in the form, wherever the experiment keeps it', () => {
    expect(seedsOf(CONDITIONING_DEFAULTS, draft({ repeats: 3 }))).toEqual([1234, 1235, 1236]);
    const decision = { ...DECISION_MAKING_DEFAULTS, decision_making: { ...DECISION_MAKING_DEFAULTS.decision_making, seed: 21 } };
    expect(seedsOf(decision, draft({ repeats: 2 }))).toEqual([21, 22]);
    const members = campaignMembers(decision, draft({ repeats: 2 }));
    expect(members.map((member) => member['decision_making'].seed)).toEqual([21, 22]);
    expect(decision.decision_making.seed).toBe(21);
  });

  it('lists the numeric parameters of the form with their labels, without the seed', () => {
    const conditioning = sweepOptions(CONDITIONING_DEFAULTS);
    expect(conditioning.find((option) => option.path === 'aud_latency_ms')?.label).toBe('Latenza uditiva (ms)');
    expect(conditioning.some((option) => option.path === 'seed')).toBe(false);
    const decision = sweepOptions(DECISION_MAKING_DEFAULTS).map((option) => option.path);
    expect(decision).toContain('decision_making.auditory_latency_ms');
    expect(decision).not.toContain('decision_making.seed');
    // Le sezioni con un titolo lo antepongono: "Test: Latenza uditiva (ms)".
    expect(sweepOptions(MSI_RACE_DEFAULTS).find((option) => option.path === 'test.aud_latency_ms')?.label).toMatch(/^Test: /);
  });

  it('reads values separated by spaces, with a decimal comma', () => {
    expect(parseValues('150 165  180')).toEqual([150, 165, 180]);
    expect(parseValues('0,9; 0.96')).toEqual([0.9, 0.96]);
    expect(parseValues('150 veloce')).toBeNull();
    expect(parseValues('')).toEqual([]);
  });

  it('multiplies seeds by values and sums the biological time', () => {
    const sweep = draft({ repeats: 2, sweepPath: 'n_test', valuesText: '10 20' });
    const members = campaignMembers(CONDITIONING_DEFAULTS, sweep);
    expect(members.map((member) => [member['n_test'], member['seed']])).toEqual([
      [10, 1234],
      [10, 1235],
      [20, 1234],
      [20, 1235],
    ]);
    expect(campaignDurationMs(CONDITIONING_DEFAULTS, sweep)).toBe(
      2 * estimateDurationMs({ ...CONDITIONING_DEFAULTS, n_test: 10 }) +
        2 * estimateDurationMs({ ...CONDITIONING_DEFAULTS, n_test: 20 }),
    );
    expect(sweepOf(sweep)).toEqual({ path: 'n_test', values: [10, 20] });
    expect(validateCampaign(CONDITIONING_DEFAULTS, sweep)).toEqual([]);
  });

  it('accepts a hand-written path for parameters the form does not show', () => {
    const custom = draft({ sweepPath: CUSTOM_PATH, customPath: ' network_overrides.eta_ex ', valuesText: '0,9 0,96' });
    expect(sweepOf(custom)).toEqual({ path: 'network_overrides.eta_ex', values: [0.9, 0.96] });
    expect(validateCampaign(DECISION_MAKING_DEFAULTS, custom)).toEqual([]);
    expect(campaignMembers(DECISION_MAKING_DEFAULTS, custom)[0]['network_overrides']).toEqual({ eta_ex: 0.9 });
  });

  it('explains what stops a campaign', () => {
    const problems = (changes: Parameters<typeof draft>[0], params: Record<string, any> = CONDITIONING_DEFAULTS) =>
      validateCampaign(params, draft(changes)).join(' ');
    expect(problems({ repeats: 0 })).toMatch(/Ripetizioni/);
    expect(problems({ repeats: 2.5 })).toMatch(/Ripetizioni/);
    expect(problems({ repeats: 51 })).toMatch(/Ripetizioni/);
    expect(problems({ sweepPath: 'aud_latency_ms', valuesText: '150' })).toMatch(/da 2 a/);
    expect(problems({ sweepPath: 'aud_latency_ms', valuesText: '150 150' })).toMatch(/diversi/);
    expect(problems({ sweepPath: 'aud_latency_ms', valuesText: '150 x' })).toMatch(/solo numeri/);
    expect(problems({ sweepPath: CUSTOM_PATH, customPath: '', valuesText: '1 2' })).toMatch(/percorso/);
    expect(problems({ sweepPath: CUSTOM_PATH, customPath: 'seed', valuesText: '1 2' })).toMatch(/seed/);
    expect(problems({ sweepPath: CUSTOM_PATH, customPath: 'builtin', valuesText: '1 2' })).toMatch(/non è un numero/);
    expect(problems({ repeats: 20, sweepPath: 'aud_latency_ms', valuesText: '150 165 180' })).toMatch(/60 simulazioni/);
    expect(problems({ sweepPath: 'n_test', valuesText: '10 100000' })).toMatch(/durata massima/);
  });
});
