/** Campagna: lo stesso lancio ripetuto con più seed e, se indicato, un parametro che varia. */

import { Sweep } from '../../../core/models';
import { formatNumber } from '../../../core/utils/format';
import { ExperimentParams, MAX_SIMULATION_MS, estimateDurationMs, experimentKind } from './experiment-params';
import { BUILTIN_META, CONTINUOUS_META, FieldMeta, RESOLUTION, SECTION_LABELS, TRIAL_META } from './experiment-validation';

export const MAX_CAMPAIGN_SIMULATIONS = 50;
export const MAX_SWEEP_VALUES = 20;
/** Voce del menu per scrivere a mano il percorso di un parametro che il modulo non mostra. */
export const CUSTOM_PATH = '__custom__';
const PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,3}$/;

export interface CampaignDraft {
  /** Numero di seed: 1 è un lancio singolo. */
  repeats: number;
  /** Percorso del parametro da variare, '' per nessuno, CUSTOM_PATH per scriverlo a mano. */
  sweepPath: string;
  customPath: string;
  /** Valori separati da spazi. */
  valuesText: string;
  saveSpikes: boolean;
}

export function emptyCampaign(): CampaignDraft {
  return {
    repeats: 1,
    sweepPath: '',
    customPath: '',
    valuesText: '',
    saveSpikes: false,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Dove sta il seed: la rete di decisione lo tiene nella propria sezione. */
export function seedPath(params: ExperimentParams): string {
  return experimentKind(params) === 'decision_making' ? 'decision_making.seed' : 'seed';
}

function lookup(params: ExperimentParams, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), params);
}

/** Copia dei parametri con `value` al percorso dato. */
function withValue(params: ExperimentParams, path: string, value: number): ExperimentParams {
  const copy = structuredClone(params);
  const keys = path.split('.');
  let section: Record<string, any> = copy;
  for (const key of keys.slice(0, -1)) {
    if (!isRecord(section[key])) section[key] = {};
    section = section[key];
  }
  section[keys[keys.length - 1]] = value;
  return copy;
}

function metaTable(params: ExperimentParams): Record<string, FieldMeta> {
  const kind = experimentKind(params);
  if (kind === 'trial_protocol') return { resolution: RESOLUTION, ...TRIAL_META };
  if (kind === 'continuous') return { resolution: RESOLUTION, ...CONTINUOUS_META };
  return BUILTIN_META[kind];
}

/** Parametri numerici del lancio che si possono variare, con l'etichetta che hanno nel modulo. */
export function sweepOptions(params: ExperimentParams): { path: string; label: string }[] {
  const table = metaTable(params);
  const seed = seedPath(params);
  const walk = (section: Record<string, any>, prefix: string): { path: string; label: string }[] =>
    Object.entries(section).flatMap(([key, value]) => {
      const path = `${prefix}${key}`;
      if (isRecord(value)) return path.split('.').length < 4 ? walk(value, `${path}.`) : [];
      if (typeof value !== 'number' || path === seed) return [];
      const sectionLabel = prefix ? SECTION_LABELS[prefix.split('.')[0]] : '';
      const label = table[key]?.label ?? key;
      return [{ path, label: sectionLabel ? `${sectionLabel}: ${label}` : label }];
    });
  return walk(params, '');
}

/** Numeri scritti separati da spazi o punto e virgola; la virgola è il separatore decimale. null se uno non è un numero. */
export function parseValues(text: string): number[] | null {
  const tokens = text.split(/[\s;]+/).filter(Boolean);
  const values = tokens.map((token) => Number(token.replace(',', '.')));
  return values.every(Number.isFinite) ? values : null;
}

export function activePath(draft: CampaignDraft): string {
  return draft.sweepPath === CUSTOM_PATH ? draft.customPath.trim() : draft.sweepPath;
}

/** Il lancio diventa una campagna con più di un seed o con un parametro che varia. */
export function isCampaign(draft: CampaignDraft): boolean {
  return draft.repeats > 1 || draft.sweepPath !== '';
}

export function sweepOf(draft: CampaignDraft): Sweep | null {
  const path = activePath(draft);
  const values = parseValues(draft.valuesText);
  return draft.sweepPath && path && values?.length ? { path, values } : null;
}

/** Seed consecutivi a partire da quello del modulo. */
export function seedsOf(params: ExperimentParams, draft: CampaignDraft): number[] {
  const first = Number(lookup(params, seedPath(params)));
  const start = Number.isInteger(first) && first >= 0 ? first : 1;
  return Array.from({ length: Math.max(1, Math.floor(draft.repeats) || 1) }, (_, index) => start + index);
}

/** Parametri di ogni simulazione della campagna, come li compone il server. */
export function campaignMembers(params: ExperimentParams, draft: CampaignDraft): ExperimentParams[] {
  const sweep = sweepOf(draft);
  const seed = seedPath(params);
  return (sweep ? sweep.values : [null]).flatMap((value) =>
    seedsOf(params, draft).map((seedValue) => {
      const member = withValue(params, seed, seedValue);
      return sweep && value !== null ? withValue(member, sweep.path, value) : member;
    }),
  );
}

/** Tempo biologico di tutte le simulazioni insieme. */
export function campaignDurationMs(params: ExperimentParams, draft: CampaignDraft): number {
  return campaignMembers(params, draft).reduce((total, member) => total + estimateDurationMs(member), 0);
}

/** Motivi per cui la campagna non può partire; vuoto se può. */
export function validateCampaign(params: ExperimentParams, draft: CampaignDraft): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(draft.repeats) || draft.repeats < 1 || draft.repeats > MAX_CAMPAIGN_SIMULATIONS) {
    problems.push(`Ripetizioni: un numero intero tra 1 e ${MAX_CAMPAIGN_SIMULATIONS}.`);
    return problems;
  }
  if (!draft.sweepPath) return problems;

  const path = activePath(draft);
  const values = parseValues(draft.valuesText);
  if (!PATH_PATTERN.test(path))
    problems.push('Parametro da variare: scrivi il percorso del parametro, ad esempio network_overrides.eta_ex.');
  else if (path === seedPath(params)) problems.push('Parametro da variare: il seed cambia già con le ripetizioni.');
  else if (lookup(params, path) !== undefined && typeof lookup(params, path) !== 'number') {
    problems.push(`Parametro da variare: ${path} non è un numero.`);
  }
  if (!values) problems.push('Valori: solo numeri, separati da spazi.');
  else if (values.length < 2 || values.length > MAX_SWEEP_VALUES) problems.push(`Valori: da 2 a ${MAX_SWEEP_VALUES}.`);
  else if (new Set(values).size !== values.length) problems.push('Valori: devono essere tutti diversi.');
  else if (values.length * draft.repeats > MAX_CAMPAIGN_SIMULATIONS) {
    problems.push(
      `La campagna avrebbe ${formatNumber(values.length * draft.repeats)} simulazioni: il massimo è ${MAX_CAMPAIGN_SIMULATIONS}.`,
    );
  } else if (!problems.length) {
    // Ogni valore deve dare una simulazione lanciabile: la durata è il controllo che il modulo sa fare da solo.
    const tooLong = campaignMembers(params, draft).some((member) => !(estimateDurationMs(member) <= MAX_SIMULATION_MS));
    if (tooLong) problems.push('Valori: almeno uno porta la simulazione oltre la durata massima.');
  }
  return problems;
}
