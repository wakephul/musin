import type { RaceModelGraph, RaceModelResult, ResponseGraph } from '../../../core/models';

const CONDITION_LABELS: Record<string, string> = {
  auditory: 'Uditivo',
  visual: 'Visivo',
  audiovisual: 'Audiovisivo',
  dual: 'Due reti (uditiva e visiva)',
};

export function conditionLabel(key: string): string {
  return CONDITION_LABELS[key] ?? key;
}

/** `none` e il vecchio `TIE` non sono id di popolazione: vanno scritti a parole. */
export function winnerLabel(winner: string | null | undefined): { text: string; isId: boolean } {
  if (!winner || winner === 'none') return { text: 'nessuna risposta', isId: false };
  if (winner === 'TIE') return { text: 'pari', isId: false };
  return { text: winner, isId: true };
}

export type RaceModelStats = RaceModelResult & { method?: string };

export interface RaceModelEntry {
  population: string;
  url: string | null;
  stats: RaceModelStats | null;
}

/**
 * Abbina grafici e statistiche per popolazione. Con un solo grafico e un solo
 * risultato li abbina anche se i nomi differiscono: le simulazioni vecchie
 * scrivevano nel JSON un nome descrittivo, diverso da quello del file.
 */
export function pairRaceModel(graphs: RaceModelGraph[], results: RaceModelStats[]): RaceModelEntry[] {
  const single = graphs.length === 1 && results.length === 1;
  const used = new Set<RaceModelStats>();
  const entries: RaceModelEntry[] = graphs.map((graph) => {
    const stats = results.find((result) => result.population === graph.population) ?? (single ? results[0] : null);
    if (stats) used.add(stats);
    return { population: stats?.population ?? graph.population, url: graph.url ?? null, stats };
  });
  for (const stats of results) {
    if (!used.has(stats)) entries.push({ population: stats.population, url: null, stats });
  }
  return entries;
}

export interface ResponsePopulation {
  label?: string;
  pop_a?: string;
  pop_b?: string;
  median_by_condition?: Record<string, number | null>;
  count_by_condition?: Record<string, number>;
}

export interface ResponseEntry {
  label: string;
  graphs: ResponseGraph[];
  rows: { condition: string; count: number | null; median: number | null }[];
}

/** Una voce per coppia di popolazioni: le mediane dal JSON e i grafici con `pair` uguale a `pop_a_pop_b`. */
export function buildResponseEntries(populations: ResponsePopulation[], graphs: ResponseGraph[]): ResponseEntry[] {
  const claimed = new Set<string>();
  const entries: ResponseEntry[] = populations.map((population) => {
    const pair = `${population.pop_a}_${population.pop_b}`;
    claimed.add(pair);
    const counts = population.count_by_condition ?? {};
    const medians = population.median_by_condition ?? {};
    const conditions = [...new Set([...Object.keys(counts), ...Object.keys(medians)])];
    return {
      label: population.label || pair,
      graphs: graphs.filter((graph) => graph.pair === pair),
      rows: conditions.map((condition) => ({
        condition,
        count: counts[condition] ?? null,
        median: medians[condition] ?? null,
      })),
    };
  });
  // Un grafico può esistere senza la sua voce nel JSON (analisi interrotta a metà): si mostra comunque.
  const orphans = [...new Set(graphs.map((graph) => graph.pair).filter((pair) => !claimed.has(pair)))];
  for (const pair of orphans) {
    entries.push({ label: pair, graphs: graphs.filter((graph) => graph.pair === pair), rows: [] });
  }
  return entries.filter((entry) => entry.graphs.length || entry.rows.length);
}
