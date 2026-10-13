import { ConnectionRule, Network, NetworkPayload, Population, Projection, Topology } from '../../../core/models';
import { countNeurons, countSynapses } from '../../../core/utils/topology';

export type JsonObject = Record<string, unknown>;
export type DegreeKey = 'indegree' | 'outdegree' | 'p';

export interface PopulationForm {
  /** Chiave interna, non salvata: le proiezioni puntano a questa, così cambiare l'ID non le scollega. */
  key: number;
  id: string;
  size: number | null;
  neuron_model: string;
  /** `params` come testo JSON. */
  params: string;
}

export interface ProjectionForm {
  source: number | null;
  target: number | null;
  rule: ConnectionRule;
  /** indegree, outdegree o p secondo la regola: nel payload torna dentro `params`. */
  degree: number | null;
  synapse_model: string;
  weight: number | null;
  delay: number | null;
  /** Le altre chiavi di `params` come testo JSON. */
  extra: string;
}

export interface NetworkFormValue {
  name: string;
  description: string;
  populations: PopulationForm[];
  projections: ProjectionForm[];
}

export type PopulationProblems = Partial<Record<'id' | 'size' | 'neuron_model' | 'params', string>>;
export type ProjectionProblems = Partial<
  Record<'source' | 'target' | 'degree' | 'synapse_model' | 'weight' | 'delay' | 'extra', string>
>;

export interface FormProblems {
  name?: string;
  populations: PopulationProblems[];
  projections: ProjectionProblems[];
  /** Il primo problema in ordine di pagina, con il punto in cui si trova. */
  first: string | null;
}

/** Topologia come serve al grafo e ai conteggi: le proiezioni indirizzano le popolazioni per chiave. */
export interface DraftTopology {
  populations: { id: string; label: string; size: number }[];
  projections: Projection[];
}

export const CONNECTION_RULES: ConnectionRule[] = [
  'all_to_all',
  'one_to_one',
  'fixed_indegree',
  'fixed_outdegree',
  'pairwise_bernoulli',
];

export const DEGREE_KEY: Partial<Record<ConnectionRule, DegreeKey>> = {
  fixed_indegree: 'indegree',
  fixed_outdegree: 'outdegree',
  pairwise_bernoulli: 'p',
};

/** Stesso limite di `MAX_POPULATION_SIZE` nel backend. */
const MAX_POPULATION_SIZE = 1_000_000;

// --- JSON dei parametri ---

export function formatJson(value: JsonObject): string {
  return JSON.stringify(value, null, 2);
}

/** Un campo vuoto vale `{}`. Lancia un errore se il testo non è un oggetto JSON. */
export function parseJsonObject(text: string): JsonObject {
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('serve un oggetto, per esempio {"V_th": -55}');
  }
  return parsed as JsonObject;
}

function tryParse(text: string): JsonObject | null {
  try {
    return parseJsonObject(text);
  } catch {
    return null;
  }
}

function jsonProblem(label: string, text: string): string | undefined {
  try {
    parseJsonObject(text);
    return undefined;
  } catch (error) {
    // V8 accoda ai messaggi brevi l'intero testo analizzato: qui basta la causa.
    const reason = (error instanceof Error ? error.message : String(error)).replace(/, ".*" is not valid JSON$/s, '');
    return error instanceof SyntaxError ? `${label}: JSON non valido (${reason}).` : `${label}: ${reason}.`;
  }
}

/** Serializzazione con le chiavi ordinate, per confrontare due oggetti senza badare all'ordine. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as JsonObject;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Testo dei parametri dopo un cambio di modello: i default del nuovo modello entrano
 * solo se il campo è vuoto o contiene ancora i default del modello precedente.
 */
export function paramsAfterModelChange(current: string, previousDefaults: JsonObject | undefined, nextDefaults: JsonObject | undefined): string {
  const parsed = tryParse(current);
  if (!parsed || !nextDefaults) return current;
  const untouched =
    Object.keys(parsed).length === 0 || (previousDefaults !== undefined && canonical(parsed) === canonical(previousDefaults));
  return untouched ? formatJson(nextDefaults) : current;
}

// --- Rete salvata -> form ---

/** Separa da `params` i valori che hanno un campo dedicato; quelli non numerici restano nel JSON. */
export function splitParams(rule: ConnectionRule, params: JsonObject): Pick<ProjectionForm, 'degree' | 'weight' | 'delay' | 'extra'> {
  const rest = { ...params };
  const take = (key: string): number | null => {
    const value = rest[key];
    if (typeof value !== 'number') return null;
    delete rest[key];
    return value;
  };
  const degreeKey = DEGREE_KEY[rule];
  return {
    degree: degreeKey ? take(degreeKey) : null,
    weight: take('weight'),
    delay: take('delay'),
    extra: formatJson(rest),
  };
}

export function toFormValue(source: Network | NetworkPayload): NetworkFormValue {
  const topology: Partial<Topology> = ('definition' in source ? source.definition?.topology : source.topology) ?? {};

  const populations = (topology.populations ?? []).map(
    (pop, key): PopulationForm => ({
      key,
      id: pop.id,
      size: pop.size,
      neuron_model: pop.neuron_model ?? '',
      params: formatJson(pop.params ?? {}),
    }),
  );
  const keyOf = (id: string): number | null => populations.find((pop) => pop.id === id)?.key ?? null;

  const projections = (topology.projections ?? []).map(
    (proj): ProjectionForm => ({
      source: keyOf(proj.source),
      target: keyOf(proj.target),
      rule: proj.rule,
      synapse_model: proj.synapse_model ?? '',
      ...splitParams(proj.rule, proj.params ?? {}),
    }),
  );

  return { name: source.name, description: source.description ?? '', populations, projections };
}

// --- Form -> payload ---

/** I campi dedicati tornano dentro `params`, dove li leggono backend e worker. */
function projectionParams(proj: ProjectionForm, extra: JsonObject): JsonObject {
  const degreeKey = DEGREE_KEY[proj.rule];
  return {
    ...(degreeKey && proj.degree !== null ? { [degreeKey]: proj.degree } : {}),
    ...(proj.weight !== null ? { weight: proj.weight } : {}),
    ...(proj.delay !== null ? { delay: proj.delay } : {}),
    ...extra,
  };
}

/**
 * Da chiamare su un form senza problemi (`validate(value).first === null`).
 * `params` è il campo libero della definizione: in modifica si rimanda quello salvato.
 */
export function toPayload(value: NetworkFormValue, params: JsonObject = {}): NetworkPayload {
  const idOf = new Map(value.populations.map((pop) => [pop.key, pop.id]));
  const endpoint = (key: number | null): string => (key === null ? '' : idOf.get(key) ?? '');

  const populations: Population[] = value.populations.map((pop) => ({
    id: pop.id,
    size: pop.size ?? 0,
    neuron_model: pop.neuron_model,
    params: parseJsonObject(pop.params),
  }));
  const projections: Projection[] = value.projections.map((proj) => ({
    source: endpoint(proj.source),
    target: endpoint(proj.target),
    rule: proj.rule,
    synapse_model: proj.synapse_model,
    params: projectionParams(proj, parseJsonObject(proj.extra)),
  }));

  return {
    name: value.name.trim(),
    description: value.description.trim() || null,
    nodes_count: countNeurons(populations),
    edges_count: countSynapses(populations, projections),
    params,
    topology: { populations, projections },
  };
}

/** Come `toPayload` ma tollerante: serve al grafo e al riepilogo mentre il form è ancora incompleto. */
export function toDraft(value: NetworkFormValue): DraftTopology {
  const keys = new Set(value.populations.map((pop) => pop.key));
  return {
    populations: value.populations.map((pop) => ({ id: String(pop.key), label: pop.id, size: pop.size ?? 0 })),
    projections: value.projections
      .filter((proj) => proj.source !== null && proj.target !== null && keys.has(proj.source) && keys.has(proj.target))
      .map((proj) => ({
        source: String(proj.source),
        target: String(proj.target),
        rule: proj.rule,
        synapse_model: proj.synapse_model,
        params: projectionParams(proj, tryParse(proj.extra) ?? {}),
      })),
  };
}

// --- Controlli ---

function isInteger(value: number | null, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

function validatePopulation(pop: PopulationForm, ids: string[]): PopulationProblems {
  const problems: PopulationProblems = {};
  if (!pop.id) problems.id = 'ID obbligatorio.';
  else if (pop.id !== pop.id.trim()) problems.id = "L'ID non può iniziare o finire con uno spazio.";
  else if (ids.indexOf(pop.id) !== ids.lastIndexOf(pop.id)) problems.id = "ID già usato da un'altra popolazione.";
  if (!isInteger(pop.size, 1, MAX_POPULATION_SIZE)) problems.size = 'Neuroni: numero intero tra 1 e 1.000.000.';
  if (!pop.neuron_model) problems.neuron_model = 'Scegli un modello.';
  const params = jsonProblem('Parametri', pop.params);
  if (params) problems.params = params;
  return problems;
}

function validateProjection(proj: ProjectionForm, keys: Set<number>): ProjectionProblems {
  const problems: ProjectionProblems = {};
  const extra = tryParse(proj.extra) ?? {};
  // Una chiave scritta in "Altri parametri" vince sul campo dedicato: tenerle entrambe sarebbe ambiguo.
  const duplicated = (key: string, field: string) => `${key} è già in Altri parametri: lascia vuoto il campo ${field}.`;

  if (proj.source === null || !keys.has(proj.source)) problems.source = 'Scegli la sorgente.';
  if (proj.target === null || !keys.has(proj.target)) problems.target = 'Scegli la destinazione.';

  const degreeKey = DEGREE_KEY[proj.rule];
  if (degreeKey && degreeKey in extra) {
    if (proj.degree !== null) problems.degree = duplicated(degreeKey, degreeKey);
  } else if (degreeKey === 'p') {
    if (proj.degree === null || proj.degree <= 0 || proj.degree > 1) problems.degree = 'p: numero maggiore di 0 e non oltre 1.';
  } else if (degreeKey && !isInteger(proj.degree, 1)) {
    problems.degree = `${degreeKey}: numero intero maggiore o uguale a 1.`;
  }

  if (!proj.synapse_model) problems.synapse_model = 'Scegli un modello di sinapsi.';
  if (proj.weight !== null && 'weight' in extra) problems.weight = duplicated('weight', 'Peso');
  if (proj.delay !== null && 'delay' in extra) problems.delay = duplicated('delay', 'Ritardo');
  else if (proj.delay !== null && proj.delay <= 0) problems.delay = 'Ritardo: deve essere maggiore di 0.';

  const json = jsonProblem('Altri parametri', proj.extra);
  if (json) problems.extra = json;
  return problems;
}

function firstIn(label: string, rows: Partial<Record<string, string>>[]): string | null {
  for (const [index, row] of rows.entries()) {
    const problem = Object.values(row)[0];
    if (problem) return `${label} ${index + 1}: ${problem}`;
  }
  return null;
}

export function validate(value: NetworkFormValue): FormProblems {
  const ids = value.populations.map((pop) => pop.id);
  const keys = new Set(value.populations.map((pop) => pop.key));
  const name = value.name.trim() ? undefined : 'Nome obbligatorio.';
  const populations = value.populations.map((pop) => validatePopulation(pop, ids));
  const projections = value.projections.map((proj) => validateProjection(proj, keys));

  const first =
    (name ? 'Manca il nome della rete.' : null) ??
    (value.populations.length ? null : 'Aggiungi almeno una popolazione.') ??
    firstIn('Popolazione', populations) ??
    firstIn('Proiezione', projections);

  return { name, populations, projections, first };
}
