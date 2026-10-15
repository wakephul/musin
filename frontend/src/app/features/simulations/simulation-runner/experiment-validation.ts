/** Etichette, vincoli e controlli dei parametri: una sola fonte per i campi dei moduli e per il blocco del lancio. */

import { RULE_PARAMS } from '../../../core/data/connection-rules';
import { MSI_REQUIRED_POPULATIONS } from '../../../core/data/protocol-presets';
import { Population, Stimulus } from '../../../core/models';
import { formatValue } from '../../../core/utils/format';
import { isStimulusModel } from '../../../core/utils/topology';
import {
  BUILTIN_DEFAULTS,
  BuiltinKind,
  ContinuousDraft,
  DeviceDraft,
  DifferentialPlot,
  ExperimentParams,
  InputsDraft,
  MAX_SIMULATION_MS,
  RunnerState,
  SENSORY_STIMULUS,
  SPIKE_TRAIN_STIMULUS,
  TrialProtocolDraft,
  buildParams,
  estimateDurationMs,
} from './experiment-params';

export interface FieldMeta {
  label: string;
  help?: string;
  min?: number;
  /** Il minimo stesso non è ammesso. */
  exclusive?: boolean;
  max?: number;
  integer?: boolean;
  /** Campo a scelta chiusa. */
  options?: { value: string | number; label: string }[];
  /** Campo di testo libero. */
  text?: boolean;
  /** Etichette dei due campi di una coppia minimo/massimo. */
  pair?: [string, string];
}

const count = (label: string, help?: string): FieldMeta => ({ label, help, min: 1, integer: true });
const positive = (label: string, help?: string): FieldMeta => ({ label, help, min: 0, exclusive: true });
const nonNegative = (label: string, help?: string): FieldMeta => ({ label, help, min: 0 });

export const SEED: FieldMeta = {
  ...count('Seed'),
  max: 2 ** 32 - 1,
  help: 'Valore iniziale dei generatori casuali: con lo stesso seed la simulazione si ripete identica.',
};
export const RESOLUTION = positive('Risoluzione (ms)', 'Passo di integrazione di NEST.');

/** Sezioni annidate dei default; una stringa vuota significa che la sezione non ha un titolo proprio. */
export const SECTION_LABELS: Record<string, string> = {
  train: 'Addestramento',
  test: 'Test',
  response: 'Lettura della risposta',
  decision_making: '',
};

// Frequenze, sorgenti e latenze stanno nella sezione di test ma il simulatore le usa per tutti i trial.
const ALSO_IN_TRAINING = 'Vale anche per i trial di addestramento.';
const MSI_LATENCY_HELP =
  `Ritardo del primo spike dall'inizio del trial. ${ALSO_IN_TRAINING} ` +
  "Una latenza che non rientra nella durata dello stimolo viene ignorata: lo stimolo parte all'inizio del trial.";

const MSI_META: Record<string, FieldMeta> = {
  seed: SEED,
  resolution: RESOLUTION,
  n_trials: count('Numero di trial'),
  trial_duration_ms: positive('Durata del trial (ms)'),
  stimulus_duration_ms: positive('Durata dello stimolo (ms)', "Finestra in cui lo stimolo è attivo, dall'inizio del trial."),
  iti_range_ms: {
    ...nonNegative('Intervallo tra trial (ms)', 'Estratto a caso tra minimo e massimo a ogni trial.'),
    pair: ['Intervallo tra trial, minimo (ms)', 'Intervallo tra trial, massimo (ms)'],
  },
  us_rate: nonNegative('Segnale di insegnamento (Hz)', 'Frequenza dei treni di Poisson inviati a IO_A.'),
  us_n_sources: count('Sorgenti del segnale di insegnamento'),
  vis_rate: nonNegative('Stimolo visivo (Hz)', ALSO_IN_TRAINING),
  aud_rate: nonNegative('Stimolo uditivo (Hz)', ALSO_IN_TRAINING),
  n_sources: count('Sorgenti per modalità', `Treni di Poisson indipendenti per ciascuno stimolo. ${ALSO_IN_TRAINING}`),
  aud_latency_ms: nonNegative('Latenza uditiva (ms)', MSI_LATENCY_HELP),
  vis_latency_ms: nonNegative('Latenza visiva (ms)', MSI_LATENCY_HELP),
  mf_dcn_weight_low: nonNegative('Peso stimolo→DCN_A, minimo', 'I pesi sono estratti uniformemente tra minimo e massimo.'),
  mf_dcn_weight_high: nonNegative('Peso stimolo→DCN_A, massimo'),
  bin_ms: positive('Bin della frequenza (ms)'),
  smooth_bins: count('Bin della media mobile'),
  baseline_ms: nonNegative('Finestra di baseline (ms)', 'Attività prima dello stimolo, usata come riferimento.'),
  threshold_delta_hz: positive('Soglia sopra la baseline (Hz)'),
};

const CONDITIONING_META: Record<string, FieldMeta> = {
  seed: SEED,
  n_train: count('Trial di addestramento', 'Metà uditivi e metà visivi, in ordine casuale.'),
  n_test: count('Trial di test per condizione', 'Le condizioni sono tre: uditiva, visiva, audiovisiva.'),
  aud_latency_ms: nonNegative('Latenza uditiva (ms)', "Ritardo del primo spike dall'inizio del trial."),
  vis_latency_ms: nonNegative('Latenza visiva (ms)', "Ritardo del primo spike dall'inizio del trial."),
  rt_smooth_bins: count('Bin della media mobile', 'Finestra, in bin da 5 ms, con cui si liscia la frequenza prima di cercare la risposta.'),
};

const DECISION_META: Record<string, FieldMeta> = {
  modality: {
    label: 'Modalità dello stimolo',
    options: [
      { value: 'auditory', label: 'Uditiva' },
      { value: 'visual', label: 'Visiva' },
      { value: 'audiovisual', label: 'Audiovisiva, sulla stessa rete' },
      { value: 'dual', label: 'Due reti, una uditiva e una visiva: risponde la più veloce' },
    ],
    help: 'Con due reti indipendenti la risposta audiovisiva è quella del Race Model: è il modello senza cervelletto di Cavadini et al. (2025).',
  },
  num_trials: count('Numero di trial'),
  rate: nonNegative('Frequenza dello stimolo (Hz)'),
  number_of_neurons: count('Afferenze sensoriali per lato'),
  stimulus_window_ms: positive('Fine dello stimolo (ms)', 'Lo stimolo è attivo dalla latenza della modalità fino a questo istante del trial.'),
  trial_slot_ms: positive('Durata del trial (ms)'),
  threshold: positive(
    'Soglia di risposta (Hz)',
    'La risposta è il primo superamento della soglia da parte della frequenza di una delle due popolazioni; è corretta se è quella stimolata.',
  ),
  rt_smooth_bins: count('Bin della media mobile', 'Finestra, in bin da 5 ms, con cui si liscia la frequenza prima di cercare la risposta.'),
  auditory_latency_ms: nonNegative('Latenza uditiva (ms)', "Ritardo del primo spike dall'inizio del trial."),
  visual_latency_ms: nonNegative('Latenza visiva (ms)', "Ritardo del primo spike dall'inizio del trial."),
  seed: SEED,
  order: count('Scala della rete', 'Neuroni: 2 × scala per ogni popolazione eccitatoria, 1 × scala per quella inibitoria.'),
};

export const BUILTIN_META: Record<BuiltinKind, Record<string, FieldMeta>> = {
  cerebellum_msi_race: MSI_META,
  cerebellum_conditioning: CONDITIONING_META,
  decision_making: DECISION_META,
};

export const DEVICE_PARAM_META: Record<string, FieldMeta> = {
  rate: nonNegative('Frequenza (Hz)'),
  n_sources: count('Sorgenti'),
  amplitude: { label: 'Ampiezza (pA)' },
};

export const CONNECTION_PARAM_META: Record<string, FieldMeta> = {
  weight: { label: 'Peso' },
  delay: positive('Ritardo (ms)'),
  indegree: count('indegree'),
  outdegree: count('outdegree'),
  p: { ...positive('p'), max: 1 },
};

export const TRIAL_META = {
  num_trials: count('Numero di trial'),
  trial_duration_ms: positive('Durata del trial (ms)'),
  stimulus_duration_ms: positive('Durata dello stimolo (ms)', "Dall'inizio del trial; il resto è la finestra di risposta."),
  iti_ms: nonNegative('Intervallo tra trial (ms)'),
  iti_min_ms: nonNegative('Intervallo minimo (ms)'),
  iti_max_ms: nonNegative('Intervallo massimo (ms)'),
  weight: nonNegative('Peso'),
  decision_margin: nonNegative(
    'Margine di decisione (spike)',
    'Il trial ha un vincitore solo se la differenza di spike tra A e B è strettamente maggiore del margine.',
  ),
  threshold: positive('Soglia (Hz)'),
  bin_size: positive('Bin (ms)'),
} satisfies Record<string, FieldMeta>;

export const CONTINUOUS_META = {
  train_duration_ms: positive("Durata dell'addestramento (ms)"),
  test_duration_ms: positive('Durata del test (ms)'),
} satisfies Record<string, FieldMeta>;

/** Chiavi senza una voce in tabella (aggiunte ai default in seguito) compaiono con il proprio nome. */
export function metaFor(table: Record<string, FieldMeta>, key: string, sample?: unknown): FieldMeta {
  return table[key] ?? { label: key, text: typeof sample === 'string' };
}

export function fieldError(meta: FieldMeta, value: unknown): string | null {
  if (meta.options) return meta.options.some((option) => option.value === value) ? null : 'Scegli un valore.';
  if (meta.text) return typeof value === 'string' && value.trim() ? null : 'Valore obbligatorio.';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Valore obbligatorio.';
  if (meta.integer && !Number.isInteger(value)) return 'Deve essere un numero intero.';
  if (meta.min !== undefined && (meta.exclusive ? value <= meta.min : value < meta.min)) {
    return meta.exclusive ? `Deve essere maggiore di ${formatValue(meta.min)}.` : `Il minimo è ${formatValue(meta.min)}.`;
  }
  if (meta.max !== undefined && value > meta.max) return `Il massimo è ${formatValue(meta.max)}.`;
  return null;
}

export interface ValidationContext {
  populations: Population[];
  /** null finché la libreria degli stimoli non è caricata. */
  stimuli: Stimulus[] | null;
}

export function missingMsiPopulations(populations: Population[]): string[] {
  const ids = new Set(populations.map((population) => population.id));
  return MSI_REQUIRED_POPULATIONS.filter((id) => !ids.has(id));
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const exceeds = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && a > b;

/** Raccoglie i messaggi nella forma "dove, campo: problema". */
class Report {
  readonly errors: string[] = [];

  field(meta: FieldMeta, value: unknown, where = '', label = meta.label): void {
    const error = fieldError(meta, value);
    if (error) this.errors.push(`${where}${label}: ${lowerFirst(error)}`);
  }

  add(message: string): void {
    this.errors.push(message);
  }
}

function builtinSection(
  report: Report,
  defaults: ExperimentParams,
  values: ExperimentParams,
  table: Record<string, FieldMeta>,
  where: string,
): void {
  for (const [key, sample] of Object.entries(defaults)) {
    if (key === 'builtin') continue;
    const value = values[key];
    const meta = metaFor(table, key, sample);
    if (Array.isArray(sample)) {
      sample.forEach((_, index) => report.field(meta, value?.[index], where, meta.pair?.[index] ?? `${meta.label} ${index + 1}`));
      if (sample.length === 2 && exceeds(value?.[0], value?.[1])) report.add(`${where}${meta.label}: il minimo supera il massimo.`);
    } else if (sample !== null && typeof sample === 'object') {
      const title = SECTION_LABELS[key] ?? key;
      builtinSection(report, sample, value ?? {}, table, title ? `${title}, ` : '');
    } else {
      report.field(meta, value, where);
    }
  }
  if (exceeds(values['stimulus_duration_ms'], values['trial_duration_ms'])) {
    report.add(`${where}la durata dello stimolo supera la durata del trial.`);
  }
}

export function validateBuiltin(kind: BuiltinKind, draft: ExperimentParams, populations: Population[]): string[] {
  const report = new Report();
  if (kind === 'cerebellum_msi_race') {
    const missing = missingMsiPopulations(populations);
    if (missing.length) {
      const what = missing.length === 1 ? 'manca una popolazione richiesta' : 'mancano popolazioni richieste';
      report.add(`Alla rete ${what} dall'esperimento: ${missing.join(', ')}.`);
    }
  }
  builtinSection(report, BUILTIN_DEFAULTS[kind], draft, BUILTIN_META[kind], '');
  if (exceeds(draft['test']?.mf_dcn_weight_low, draft['test']?.mf_dcn_weight_high)) {
    report.add('Test, peso stimolo→DCN_A: il minimo supera il massimo.');
  }
  if (exceeds(draft['decision_making']?.stimulus_window_ms, draft['decision_making']?.trial_slot_ms)) {
    report.add('La fine dello stimolo supera la durata del trial.');
  }
  return report.errors.map(capitalize);
}

/** Numero di nodi NEST creati per un dispositivo, quando si può sapere prima del lancio. */
function deviceSize(device: DeviceDraft, stimuli: Stimulus[] | null): number | undefined {
  if (device.model === SENSORY_STIMULUS) return Number(device.params['n_sources']) || undefined;
  if (device.model === SPIKE_TRAIN_STIMULUS) {
    return stimuli?.find((stimulus) => stimulus.id === device.params['stimulus_id'])?.definition?.n_trains;
  }
  return 1;
}

const INVALID_EXTRA = 'gli altri parametri non sono un oggetto JSON valido.';

function validateInputs(report: Report, inputs: InputsDraft, ctx: ValidationContext, resolution: number): void {
  const populations = new Map(ctx.populations.map((population) => [population.id, population]));
  const idCount = new Map<string, number>();
  for (const device of inputs.devices) idCount.set(device.id, (idCount.get(device.id) ?? 0) + 1);
  for (const [id, uses] of idCount) {
    if (id && uses > 1) report.add(`L'ID ${id} è usato da ${uses} dispositivi.`);
  }

  inputs.devices.forEach((device, index) => {
    const where = `Dispositivo ${device.id || index + 1}: `;
    if (!device.id) report.add(`${where}manca l'ID.`);
    else if (!/^\w+$/.test(device.id)) report.add(`${where}l'ID ammette solo lettere, cifre e _.`);
    if (!device.model) report.add(`${where}scegli il modello.`);
    if (device.invalidExtra !== undefined) report.add(`${where}${INVALID_EXTRA}`);

    for (const [key, value] of Object.entries(device.params)) {
      if (key === 'stimulus_id') {
        if (!Number.isInteger(value)) report.add(`${where}scegli uno stimolo dalla libreria.`);
        else if (ctx.stimuli && !ctx.stimuli.some((stimulus) => stimulus.id === value)) {
          report.add(`${where}lo stimolo selezionato non è più nella libreria.`);
        }
      } else if (key in DEVICE_PARAM_META) {
        report.field(DEVICE_PARAM_META[key], value, where);
      }
    }
  });

  inputs.connections.forEach((connection, index) => {
    const where = `Connessione ${index + 1}: `;
    const device = connection.device && inputs.devices.includes(connection.device) ? connection.device : null;
    if (!device) report.add(`${where}scegli il dispositivo sorgente.`);
    const target = populations.get(connection.target);
    if (!connection.target) report.add(`${where}scegli la popolazione di destinazione.`);
    else if (!target) report.add(`${where}la popolazione ${connection.target} non esiste nella rete.`);
    else if (isStimulusModel(target.neuron_model)) {
      report.add(`${where}la popolazione ${connection.target} è una sorgente di stimolo: scegli una popolazione di neuroni.`);
    }

    report.field(CONNECTION_PARAM_META['weight'], connection.params['weight'], where);
    report.field(CONNECTION_PARAM_META['delay'], connection.params['delay'], where);
    if (exceeds(resolution, connection.params['delay'])) {
      report.add(`${where}il ritardo non può essere inferiore alla risoluzione (${formatValue(resolution)} ms).`);
    }
    const ruleParam = RULE_PARAMS[connection.rule];
    if (ruleParam) report.field(CONNECTION_PARAM_META[ruleParam.key], connection.params[ruleParam.key], where);
    if (connection.invalidExtra !== undefined) report.add(`${where}${INVALID_EXTRA}`);

    const sources = device ? deviceSize(device, ctx.stimuli) : undefined;
    const targets = target?.size;
    if (connection.rule === 'one_to_one' && sources !== undefined && targets !== undefined && sources !== targets) {
      report.add(
        `${where}one_to_one richiede lo stesso numero di sorgenti (${formatValue(sources)}) e di neuroni (${formatValue(targets)}).`,
      );
    }
  });
}

/** Le popolazioni che il simulatore registra: solo queste possono entrare in una coppia differenziale. */
function recordedIds(populations: Population[]): Set<string> {
  return new Set(populations.filter((population) => !isStimulusModel(population.neuron_model)).map((population) => population.id));
}

function validatePlots(report: Report, plots: DifferentialPlot[], populationIds: Set<string>): void {
  plots.forEach((plot, index) => {
    const where = `Coppia ${index + 1}: `;
    if (!populationIds.has(plot.pop_a) || !populationIds.has(plot.pop_b)) report.add(`${where}scegli le due popolazioni.`);
    else if (plot.pop_a === plot.pop_b) report.add(`${where}le due popolazioni devono essere diverse.`);
  });
}

function validateKernel(report: Report, draft: { seed: number | null; resolution: number }): void {
  report.field(SEED, draft.seed);
  report.field(RESOLUTION, draft.resolution);
}

export function validateTrialProtocol(draft: TrialProtocolDraft, ctx: ValidationContext): string[] {
  const report = new Report();
  const populationIds = new Set(ctx.populations.map((population) => population.id));

  validateInputs(report, draft.inputs, ctx, draft.resolution);

  if (!draft.conditions.length) report.add('Aggiungi almeno una condizione.');
  const labels = draft.conditions.map((condition) => condition.condition_label.trim());
  draft.conditions.forEach((condition, index) => {
    const where = `Condizione ${labels[index] || index + 1}: `;
    if (!labels[index]) report.add(`${where}manca l'etichetta.`);
    else if (labels.indexOf(labels[index]) !== index) report.add(`${where}etichetta usata da più condizioni.`);
    report.field(TRIAL_META.weight, condition.weight, where);
    if (condition.expected_winner && !populationIds.has(condition.expected_winner)) {
      report.add(`${where}la risposta attesa ${condition.expected_winner} non esiste nella rete.`);
    }
  });
  if (draft.conditions.length && !draft.conditions.some((condition) => exceeds(condition.weight, 0))) {
    report.add('Almeno una condizione deve avere peso maggiore di 0.');
  }

  report.field(TRIAL_META.num_trials, draft.num_trials);
  report.field(TRIAL_META.trial_duration_ms, draft.trial_duration_ms);
  report.field(TRIAL_META.stimulus_duration_ms, draft.stimulus_duration_ms);
  if (exceeds(draft.stimulus_duration_ms, draft.trial_duration_ms)) {
    report.add('La durata dello stimolo supera la durata del trial.');
  }
  if (draft.iti_random) {
    report.field(TRIAL_META.iti_min_ms, draft.iti_range_ms[0]);
    report.field(TRIAL_META.iti_max_ms, draft.iti_range_ms[1]);
    if (exceeds(draft.iti_range_ms[0], draft.iti_range_ms[1])) report.add("L'intervallo minimo tra trial supera il massimo.");
  } else {
    report.field(TRIAL_META.iti_ms, draft.iti_ms);
  }
  validateKernel(report, draft);

  validatePlots(report, draft.differential_plots, recordedIds(ctx.populations));
  report.field(TRIAL_META.decision_margin, draft.decision_margin);
  if (draft.response_cdf.enabled) {
    report.field(TRIAL_META.threshold, draft.response_cdf.threshold, 'Tempi di risposta, ');
    report.field(TRIAL_META.bin_size, draft.response_cdf.bin_size, 'Tempi di risposta, ');
  }
  if (draft.race_model.enabled) {
    const unknown = draft.race_model.populations.filter((id) => !populationIds.has(id));
    if (!draft.race_model.populations.length) report.add('Race Model Inequality: scegli almeno una popolazione.');
    if (unknown.length) {
      report.add(`Race Model Inequality: ${unknown.join(', ')} ${unknown.length === 1 ? 'non è' : 'non sono'} nella rete.`);
    }
    const missing = ['V', 'A', 'AV'].filter((label) => !labels.includes(label));
    if (missing.length) {
      const what = missing.length === 1 ? 'manca la condizione' : 'mancano le condizioni';
      report.add(`Race Model Inequality: ${what} con etichetta ${missing.join(', ')}.`);
    }
  }
  return report.errors;
}

export function validateContinuous(draft: ContinuousDraft, ctx: ValidationContext): string[] {
  const report = new Report();
  validateInputs(report, draft.inputs, ctx, draft.resolution);
  if (draft.training) report.field(CONTINUOUS_META.train_duration_ms, draft.train_duration_ms);
  report.field(CONTINUOUS_META.test_duration_ms, draft.test_duration_ms);
  validateKernel(report, draft);
  validatePlots(report, draft.differential_plots, recordedIds(ctx.populations));
  return report.errors;
}

/** Ciò che impedisce il lancio nella modalità attiva; le bozze delle altre modalità non contano. */
export function validateState(state: RunnerState, ctx: ValidationContext): string[] {
  const errors =
    state.mode === 'builtin'
      ? validateBuiltin(state.builtin, state.builtinDrafts[state.builtin], ctx.populations)
      : state.mode === 'trials'
        ? validateTrialProtocol(state.trials, ctx)
        : validateContinuous(state.continuous, ctx);
  const seconds = estimateDurationMs(buildParams(state)) / 1000;
  if (seconds > MAX_SIMULATION_MS / 1000) {
    errors.push(
      `Il tempo biologico (${formatValue(Math.round(seconds))} s) supera il massimo di ${formatValue(MAX_SIMULATION_MS / 1000)} s per simulazione.`,
    );
  }
  return errors;
}
