/**
 * Parametri di un esperimento: bozze dei moduli, payload per l'API e mappatura
 * inversa per ripartire dai parametri di una simulazione già lanciata.
 */

import {
  CONDITIONING_DEFAULTS,
  DECISION_MAKING_DEFAULTS,
  MSI_RACE_DEFAULTS,
} from '../../../core/data/protocol-presets';
import { ConnectionRule, ExperimentKind } from '../../../core/models';

export type ExperimentParams = Record<string, any>;
export type RunMode = 'builtin' | 'trials' | 'continuous';
export type BuiltinKind = 'cerebellum_msi_race' | 'cerebellum_conditioning' | 'decision_making';

export const BUILTIN_DEFAULTS: Record<BuiltinKind, ExperimentParams> = {
  cerebellum_msi_race: MSI_RACE_DEFAULTS,
  cerebellum_conditioning: CONDITIONING_DEFAULTS,
  decision_making: DECISION_MAKING_DEFAULTS,
};
export const BUILTIN_KINDS = Object.keys(BUILTIN_DEFAULTS) as BuiltinKind[];

// Stessi valori di backend/services/experiments.py e backend/core/config.py.
export const CONDITIONING_TRIAL_MS = 3000;
export const MAX_SIMULATION_MS = 3_600_000;

export const STATIC_SYNAPSE = 'static_synapse';
export const SPIKE_TRAIN_STIMULUS = 'spike_train_stimulus';
export const SENSORY_STIMULUS = 'legacy_sensory_stimulus';

/** Parametro che ogni regola di connessione aggiunge a `params`, con il valore proposto. */
export const RULE_PARAMS: Record<ConnectionRule, { key: string; initial: number } | null> = {
  all_to_all: null,
  one_to_one: null,
  fixed_indegree: { key: 'indegree', initial: 1 },
  fixed_outdegree: { key: 'outdegree', initial: 1 },
  pairwise_bernoulli: { key: 'p', initial: 0.1 },
};
export const CONNECTION_RULES = Object.keys(RULE_PARAMS) as ConnectionRule[];

// --- Bozze dei moduli generici ---

export interface DeviceDraft {
  id: string;
  model: string;
  params: Record<string, unknown>;
}

/**
 * Connessioni e condizioni puntano all'oggetto del dispositivo, non al suo id:
 * rinominare un dispositivo non le lascia orfane.
 */
export interface ConnectionDraft {
  device: DeviceDraft | null;
  target: string;
  rule: ConnectionRule;
  synapse_model: string;
  params: Record<string, unknown>;
}

export interface InputsDraft {
  devices: DeviceDraft[];
  connections: ConnectionDraft[];
}

export interface DifferentialPlot {
  pop_a: string;
  pop_b: string;
  label: string;
}

export interface ConditionDraft {
  condition_label: string;
  devices: DeviceDraft[];
  weight: number | null;
  expected_winner: string | null;
}

export interface TrialProtocolDraft {
  resolution: number;
  seed: number | null;
  num_trials: number | null;
  trial_duration_ms: number | null;
  stimulus_duration_ms: number | null;
  iti_random: boolean;
  iti_ms: number | null;
  iti_range_ms: [number | null, number | null];
  conditions: ConditionDraft[];
  inputs: InputsDraft;
  differential_plots: DifferentialPlot[];
  decision_margin: number | null;
  response_cdf: { enabled: boolean; threshold: number | null; bin_size: number | null };
  race_model: { enabled: boolean; populations: string[] };
}

export interface ContinuousDraft {
  resolution: number;
  seed: number | null;
  training: boolean;
  train_duration_ms: number | null;
  test_duration_ms: number | null;
  disable_plasticity_during_test: boolean;
  inputs: InputsDraft;
  differential_plots: DifferentialPlot[];
}

/** Stato dell'intera schermata: ogni modalità ha la propria bozza, indipendente dalle altre. */
export interface RunnerState {
  mode: RunMode;
  builtin: BuiltinKind;
  builtinDrafts: Record<BuiltinKind, ExperimentParams>;
  trials: TrialProtocolDraft;
  continuous: ContinuousDraft;
}

export function emptyTrialProtocol(): TrialProtocolDraft {
  return {
    resolution: 0.1,
    seed: 1234,
    num_trials: 20,
    trial_duration_ms: 1000,
    stimulus_duration_ms: 500,
    iti_random: false,
    iti_ms: 500,
    iti_range_ms: [500, 1000],
    conditions: [],
    inputs: { devices: [], connections: [] },
    differential_plots: [],
    decision_margin: 0,
    response_cdf: { enabled: true, threshold: 15, bin_size: 5 },
    race_model: { enabled: false, populations: [] },
  };
}

export function emptyContinuous(): ContinuousDraft {
  return {
    resolution: 0.1,
    seed: 1234,
    training: false,
    train_duration_ms: 2000,
    test_duration_ms: 1000,
    disable_plasticity_during_test: true,
    inputs: { devices: [], connections: [] },
    differential_plots: [],
  };
}

/** Cambia la regola di una connessione tenendo in `params` solo il parametro della nuova regola. */
export function setConnectionRule(connection: ConnectionDraft, rule: ConnectionRule): void {
  for (const spec of Object.values(RULE_PARAMS)) {
    if (spec) delete connection.params[spec.key];
  }
  connection.rule = rule;
  const spec = RULE_PARAMS[rule];
  if (spec) connection.params[spec.key] = spec.initial;
}

// --- Esperimenti predefiniti ---

/**
 * Copia di `values` con esattamente le chiavi di `defaults`: le chiavi estranee
 * non passano, quelle assenti prendono il valore di default.
 */
function shapeLike(defaults: any, values: any): any {
  if (Array.isArray(defaults)) {
    return defaults.map((item, index) => shapeLike(item, Array.isArray(values) ? values[index] : undefined));
  }
  if (defaults !== null && typeof defaults === 'object') {
    const source = values !== null && typeof values === 'object' ? values : {};
    return Object.fromEntries(Object.keys(defaults).map((key) => [key, shapeLike(defaults[key], source[key])]));
  }
  return values === undefined ? defaults : values;
}

/** Bozza di un esperimento predefinito: i default, sovrascritti dai parametri di una simulazione precedente. */
export function builtinDraft(kind: BuiltinKind, params?: ExperimentParams | null): ExperimentParams {
  return { ...shapeLike(BUILTIN_DEFAULTS[kind], params ?? {}), builtin: kind };
}

export function buildBuiltinParams(kind: BuiltinKind, draft: ExperimentParams): ExperimentParams {
  return builtinDraft(kind, draft);
}

// --- Moduli generici ---

function buildInputs(inputs: InputsDraft): ExperimentParams {
  return {
    devices: inputs.devices.map((device) => ({ id: device.id, model: device.model, params: { ...device.params } })),
    connections: inputs.connections.map((connection) => ({
      source: connection.device?.id ?? '',
      target: connection.target,
      rule: connection.rule,
      synapse_model: connection.synapse_model,
      params: { ...connection.params },
    })),
  };
}

function buildPlots(plots: DifferentialPlot[]): DifferentialPlot[] {
  return plots.map((plot) => ({
    pop_a: plot.pop_a,
    pop_b: plot.pop_b,
    label: plot.label.trim() || `${plot.pop_a} − ${plot.pop_b}`,
  }));
}

export function buildTrialProtocolParams(draft: TrialProtocolDraft): ExperimentParams {
  return {
    resolution: draft.resolution,
    seed: draft.seed,
    protocol: {
      num_trials: draft.num_trials,
      trial_duration_ms: draft.trial_duration_ms,
      stimulus_duration_ms: draft.stimulus_duration_ms,
      ...(draft.iti_random ? { iti_range_ms: [...draft.iti_range_ms] } : { iti_ms: draft.iti_ms }),
      stimuli_pool: draft.conditions.map((condition) => ({
        // Dai dispositivi attuali: uno rimosso dopo la selezione non resta nel pool.
        devices: draft.inputs.devices.filter((device) => condition.devices.includes(device)).map((device) => device.id),
        weight: condition.weight,
        condition_label: condition.condition_label.trim(),
        expected_winner: condition.expected_winner || null,
      })),
    },
    inputs: buildInputs(draft.inputs),
    analysis: {
      differential_plots: buildPlots(draft.differential_plots),
      decision_margin: draft.decision_margin,
      response_cdf: { ...draft.response_cdf },
      race_model: {
        enabled: draft.race_model.enabled,
        populations: draft.race_model.enabled ? [...draft.race_model.populations] : [],
      },
    },
  };
}

export function buildContinuousParams(draft: ContinuousDraft): ExperimentParams {
  return {
    resolution: draft.resolution,
    seed: draft.seed,
    phases: {
      // Sempre esplicito: senza la chiave il worker può applicare un proprio default.
      train_duration_ms: draft.training ? draft.train_duration_ms : 0,
      test_duration_ms: draft.test_duration_ms,
      disable_plasticity_during_test: draft.disable_plasticity_during_test,
    },
    inputs: buildInputs(draft.inputs),
    analysis: { differential_plots: buildPlots(draft.differential_plots) },
  };
}

/** Payload di lancio: solo la bozza della modalità attiva. */
export function buildParams(state: RunnerState): ExperimentParams {
  switch (state.mode) {
    case 'builtin':
      return buildBuiltinParams(state.builtin, state.builtinDrafts[state.builtin]);
    case 'trials':
      return buildTrialProtocolParams(state.trials);
    case 'continuous':
      return buildContinuousParams(state.continuous);
  }
}

// --- Dai parametri di una simulazione alle bozze ---

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function inputsDraft(inputs: unknown): InputsDraft {
  const source = asRecord(inputs);
  const devices: DeviceDraft[] = asArray(source['devices']).map((device) => ({
    id: String(device?.id ?? ''),
    model: String(device?.model ?? ''),
    params: { ...asRecord(device?.params) },
  }));
  const byId = new Map(devices.map((device) => [device.id, device]));
  const connections: ConnectionDraft[] = asArray(source['connections']).map((connection) => ({
    device: byId.get(connection?.source) ?? null,
    target: String(connection?.target ?? ''),
    rule: connection?.rule in RULE_PARAMS ? connection.rule : 'all_to_all',
    synapse_model: String(connection?.synapse_model ?? STATIC_SYNAPSE),
    params: { ...asRecord(connection?.params) },
  }));
  return { devices, connections };
}

function plotsDraft(analysis: Record<string, any>): DifferentialPlot[] {
  return asArray(analysis['differential_plots']).map((plot) => ({
    pop_a: String(plot?.pop_a ?? ''),
    pop_b: String(plot?.pop_b ?? ''),
    label: String(plot?.label ?? ''),
  }));
}

function trialProtocolDraft(params: ExperimentParams): TrialProtocolDraft {
  const base = emptyTrialProtocol();
  const protocol = asRecord(params['protocol']);
  const analysis = asRecord(params['analysis']);
  const cdf = asRecord(analysis['response_cdf']);
  const race = asRecord(analysis['race_model']);
  const inputs = inputsDraft(params['inputs']);
  const byId = new Map(inputs.devices.map((device) => [device.id, device]));
  const range = protocol['iti_range_ms'];
  const random = Array.isArray(range) && range.length === 2;
  const trialMs = protocol['trial_duration_ms'] ?? base.trial_duration_ms;
  return {
    resolution: params['resolution'] ?? base.resolution,
    seed: params['seed'] ?? base.seed,
    num_trials: protocol['num_trials'] ?? base.num_trials,
    trial_duration_ms: trialMs,
    // Senza la chiave il worker tiene lo stimolo acceso per tutto il trial.
    stimulus_duration_ms: protocol['stimulus_duration_ms'] ?? trialMs,
    iti_random: random,
    iti_ms: random ? base.iti_ms : (protocol['iti_ms'] ?? 0),
    iti_range_ms: random ? [range[0], range[1]] : base.iti_range_ms,
    conditions: asArray(protocol['stimuli_pool']).map((entry) => ({
      condition_label: String(entry?.condition_label ?? ''),
      devices: asArray(entry?.devices).flatMap((id) => byId.get(id) ?? []),
      weight: entry?.weight ?? 1,
      expected_winner: entry?.expected_winner || null,
    })),
    inputs,
    differential_plots: plotsDraft(analysis),
    decision_margin: analysis['decision_margin'] ?? base.decision_margin,
    response_cdf: {
      enabled: cdf['enabled'] !== false,
      threshold: cdf['threshold'] ?? base.response_cdf.threshold,
      bin_size: cdf['bin_size'] ?? base.response_cdf.bin_size,
    },
    race_model: { enabled: !!race['enabled'], populations: asArray(race['populations']).map(String) },
  };
}

function continuousDraft(params: ExperimentParams): ContinuousDraft {
  const base = emptyContinuous();
  const phases = asRecord(params['phases']);
  const trainMs = Number(phases['train_duration_ms']) || 0;
  return {
    resolution: params['resolution'] ?? base.resolution,
    seed: params['seed'] ?? base.seed,
    training: trainMs > 0,
    train_duration_ms: trainMs > 0 ? trainMs : base.train_duration_ms,
    test_duration_ms: phases['test_duration_ms'] ?? base.test_duration_ms,
    disable_plasticity_during_test: phases['disable_plasticity_during_test'] !== false,
    inputs: inputsDraft(params['inputs']),
    differential_plots: plotsDraft(asRecord(params['analysis'])),
  };
}

/** Stessa regola di `experiment_kind` nel backend. */
export function experimentKind(params: ExperimentParams): ExperimentKind {
  const builtin = params['builtin'];
  if (BUILTIN_KINDS.includes(builtin)) return builtin;
  return params['protocol'] ? 'trial_protocol' : 'continuous';
}

/**
 * Stato iniziale della schermata. Con i parametri di una simulazione precedente
 * apre la modalità corrispondente e ne riempie la bozza; le altre restano ai default.
 */
export function stateFromParams(params?: ExperimentParams | null): RunnerState {
  const state: RunnerState = {
    mode: 'builtin',
    builtin: 'cerebellum_msi_race',
    builtinDrafts: {
      cerebellum_msi_race: builtinDraft('cerebellum_msi_race'),
      cerebellum_conditioning: builtinDraft('cerebellum_conditioning'),
      decision_making: builtinDraft('decision_making'),
    },
    trials: emptyTrialProtocol(),
    continuous: emptyContinuous(),
  };
  if (!params || typeof params !== 'object') return state;

  const kind = experimentKind(params);
  if (kind === 'trial_protocol') {
    state.mode = 'trials';
    state.trials = trialProtocolDraft(params);
  } else if (kind === 'continuous') {
    state.mode = 'continuous';
    state.continuous = continuousDraft(params);
  } else {
    state.builtin = kind;
    state.builtinDrafts[kind] = builtinDraft(kind, params);
  }
  return state;
}

// --- Durata ---

/**
 * Tempo biologico totale in ms, con le regole di `estimate_duration_ms` del backend.
 * Con ITI casuale è una stima per eccesso (usa l'estremo superiore).
 */
export function estimateDurationMs(params: ExperimentParams): number {
  const upperIti = (section: Record<string, any>) => Number(asArray(section['iti_range_ms'])[1]);
  const trialPhase = (section: Record<string, any>) =>
    Number(section['n_trials']) * (Number(section['trial_duration_ms']) + upperIti(section));

  switch (experimentKind(params)) {
    case 'decision_making': {
      const dm = asRecord(params['decision_making']);
      return Number(dm['trial_slot_ms']) * Number(dm['num_trials']);
    }
    case 'cerebellum_conditioning':
      return (Number(params['n_train']) + 3 * Number(params['n_test'])) * CONDITIONING_TRIAL_MS;
    case 'cerebellum_msi_race':
      return trialPhase(asRecord(params['train'])) + trialPhase(asRecord(params['test']));
    case 'trial_protocol': {
      const protocol = asRecord(params['protocol']);
      const iti = protocol['iti_range_ms'] ? upperIti(protocol) : Number(protocol['iti_ms'] ?? 0);
      return Number(protocol['num_trials']) * (Number(protocol['trial_duration_ms']) + iti);
    }
    case 'continuous': {
      const phases = asRecord(params['phases']);
      return Number(phases['train_duration_ms'] ?? 0) + Number(phases['test_duration_ms'] ?? 0);
    }
  }
}
