/** Testi e stato delle campagne: logica pura, usata dalla panoramica e dalla pagina della campagna. */

import { Campaign, CampaignGroup, SimulationStatus } from '../../core/models';
import { formatNumber, formatValue, plural } from '../../core/utils/format';
import { parameterLabel } from '../simulations/simulation-runner/campaign-draft';

export const CONDITION_LABELS: Record<string, string> = {
  A: 'Uditivo',
  V: 'Visivo',
  AV: 'Audiovisivo',
  race: 'Modello a gara',
};

type Counts = Record<SimulationStatus, number>;

export function totalOf(counts: Counts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/** Una campagna è attiva finché ha simulazioni in coda o in corso. */
export function isActive(counts: Counts): boolean {
  return counts.PENDING + counts.RUNNING > 0;
}

/** Stato della campagna nel suo insieme, con la classe di `.status-*`. */
export function campaignState(counts: Counts): {
  label: string;
  className: string;
} {
  const total = totalOf(counts);
  // Tutte le simulazioni eliminate una per una.
  if (!total) return { label: 'Senza simulazioni', className: 'status' };
  if (isActive(counts)) {
    const started = counts.RUNNING + counts.COMPLETED + counts.FAILED + counts.ABORTED > 0;
    return started
      ? { label: 'In corso', className: 'status status-running' }
      : { label: 'In coda', className: 'status status-pending' };
  }
  if (counts.COMPLETED === total) return { label: 'Completata', className: 'status status-completed' };
  if (counts.COMPLETED > 0) return { label: 'Completata in parte', className: 'status status-pending' };
  if (counts.FAILED > 0) return { label: 'Fallita', className: 'status status-failed' };
  return { label: 'Interrotta', className: 'status' };
}

/** "12 simulazioni: 8 completate, 1 in corso, 3 in coda": solo gli stati che hanno qualcosa. */
export function countsText(counts: Counts): string {
  const parts = [
    counts.COMPLETED ? plural(counts.COMPLETED, 'completata', 'completate') : '',
    counts.RUNNING ? `${formatNumber(counts.RUNNING)} in corso` : '',
    counts.PENDING ? `${formatNumber(counts.PENDING)} in coda` : '',
    counts.FAILED ? plural(counts.FAILED, 'fallita', 'fallite') : '',
    counts.ABORTED ? plural(counts.ABORTED, 'interrotta', 'interrotte') : '',
  ].filter(Boolean);
  return `${plural(totalOf(counts), 'simulazione', 'simulazioni')}: ${parts.join(', ')}`;
}

/** "11–13" per seed consecutivi, altrimenti l'elenco. */
export function seedsText(seeds: number[]): string {
  if (!seeds.length) return 'n.d.';
  const consecutive = seeds.every((seed, index) => index === 0 || seed === seeds[index - 1] + 1);
  return consecutive && seeds.length > 2 ? `${seeds[0]}–${seeds[seeds.length - 1]}` : seeds.join(', ');
}

/** Nome del parametro variabile come lo mostra il modulo di lancio; il percorso se il modulo non lo ha. */
export function sweepLabel(campaign: Campaign): string | null {
  if (!campaign.sweep) return null;
  return parameterLabel(campaign.params, campaign.sweep.path);
}

export function valueText(value: number | null): string {
  return value === null ? 'n.d.' : formatValue(value);
}

/** "328 (305–372)": mediana con il suo intervallo di confidenza, o solo la mediana se l'intervallo manca. */
export function medianText(median: number | null, interval: [number, number] | null): string {
  if (median === null) return 'nessuna risposta';
  const text = formatNumber(median, 1, 0);
  return interval ? `${text} (${formatNumber(interval[0], 1, 0)}–${formatNumber(interval[1], 1, 0)})` : text;
}

/** "+8 (−12 … +28)": differenza dal riferimento con l'intervallo, sempre con il segno. */
export function differenceText(comparison: { difference_ms: number; ci95_ms: [number, number] } | null | undefined): string {
  if (!comparison) return 'n.d.';
  const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), 1, 0)}`;
  return `${signed(comparison.difference_ms)} (${signed(comparison.ci95_ms[0])} … ${signed(comparison.ci95_ms[1])})`;
}

export function pText(p: number): string {
  return p < 0.001 ? 'p < 0,001' : `p = ${p.toFixed(3).replace('.', ',')}`;
}

export interface ChartSeries {
  label: string;
  values: number[];
  condition: string;
  reference: boolean;
}

/** Curve del grafico dei percentili: una per condizione, più quelle del riferimento se c'è. */
export function chartSeries(group: CampaignGroup): ChartSeries[] {
  const levels = group.percentile_levels.length;
  const complete = (values: number[] | undefined) => values?.length === levels;
  const simulated = group.conditions
    .filter((row) => complete(row.percentiles_ms))
    .map((row) => ({
      label: CONDITION_LABELS[row.label] ?? row.label,
      values: row.percentiles_ms,
      condition: row.label,
      reference: false,
    }));
  const reference = group.conditions
    .filter((row) => complete(row.reference?.percentiles_ms))
    .map((row) => ({
      label: `${CONDITION_LABELS[row.label] ?? row.label}, riferimento`,
      values: row.reference!.percentiles_ms,
      condition: row.label,
      reference: true,
    }));
  return [...simulated, ...reference];
}
