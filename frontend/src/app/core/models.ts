/** Tipi dei dati scambiati con l'API (`/api/v1`). */

export interface User {
  id: number;
  email: string;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// --- Reti ---

export type ConnectionRule =
  | 'all_to_all'
  | 'one_to_one'
  | 'fixed_indegree'
  | 'fixed_outdegree'
  | 'pairwise_bernoulli';

export interface Population {
  id: string;
  size: number;
  neuron_model: string;
  params: Record<string, unknown>;
}

/** indegree / outdegree / p stanno dentro `params`, insieme a weight, delay ecc. */
export interface Projection {
  source: string;
  target: string;
  rule: ConnectionRule;
  synapse_model: string;
  params: Record<string, unknown>;
}

export interface Topology {
  populations: Population[];
  projections: Projection[];
}

export interface NetworkDefinition {
  nodes_count: number;
  edges_count: number;
  params: Record<string, unknown>;
  topology: Topology;
}

export interface Network {
  id: number;
  name: string;
  description: string | null;
  definition: NetworkDefinition;
  parent_id: number | null;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

export interface NetworkPayload {
  name: string;
  description?: string | null;
  nodes_count: number;
  edges_count: number;
  params: Record<string, unknown>;
  topology: Topology;
}

export interface ModelInfo {
  id: string;
  label: string;
  description?: string;
  default_params: Record<string, unknown>;
}

export interface ModelModule {
  id: string;
  label: string;
  description: string;
  neurons: ModelInfo[];
  synapses: ModelInfo[];
}

export interface ModelCatalogue {
  modules: ModelModule[];
  stimulus_devices: ModelInfo[];
}

// --- Stimoli ---

export interface Stimulus {
  id: number;
  name: string;
  description: string | null;
  definition: {
    n_trains: number;
    n_spikes: number;
    duration_ms: number;
    source_filename: string | null;
  } | null;
  owner_id: number;
  created_at: string;
}

// --- Simulazioni ---

export type SimulationStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED';

export type ExperimentKind =
  | 'cerebellum_msi_race'
  | 'cerebellum_conditioning'
  | 'decision_making'
  | 'trial_protocol'
  | 'continuous';

export interface Simulation {
  id: number;
  name: string;
  network_id: number;
  /** Campagna di cui la simulazione fa parte, se è una ripetizione. */
  campaign_id?: number | null;
  network_name: string | null;
  owner_id: number;
  status: SimulationStatus;
  experiment: ExperimentKind;
  duration_ms: number;
  experiment_params: Record<string, any>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimulationPage {
  items: Simulation[];
  total: number;
  /** Conteggio per stato su tutte le simulazioni dell'utente, indipendente dai filtri. */
  counts: Record<SimulationStatus, number>;
}

export interface SimulationProgress {
  status: SimulationStatus;
  progress: number;
  phase: string | null;
  error_message: string | null;
  network_id: number;
  experiment_params: Record<string, any>;
}

export interface PopulationGraph {
  population_id: string;
  raster_url: string | null;
  histogram_url: string | null;
}

export interface LabelledGraph {
  label: string;
  url: string;
}

export interface RaceModelGraph {
  population: string;
  url: string;
}

export interface ResponseGraph {
  kind: 'activation' | 'cdf';
  pair: string;
  url: string;
}

export interface TrialDetail {
  trial: number;
  active_stimuli: string[];
  condition_label?: string;
  expected_winner: string;
  actual_winner: string;
  /** null quando il trial non ha una risposta attesa e non entra nel conteggio. */
  is_correct: boolean | null;
  net_evidence: number | null;
}

export interface AccuracyMetric {
  comparison: string;
  /** null quando nessun trial ha una risposta attesa. */
  accuracy_percent: number | null;
  total_valid_trials: number;
  correct_trials: number;
  /** Solo per gli esperimenti di rilevazione (integrazione multisensoriale AV). */
  detection?: {
    hits: number;
    misses: number;
    /** Risposte sulla via non addestrata. */
    wrong_pathway?: number;
    false_alarms: number;
    correct_rejections: number;
  };
  trial_details: TrialDetail[];
}

export interface RaceModelResult {
  population: string;
  n_V: number;
  n_A: number;
  n_AV: number;
  max_rmi_violation: number;
  /** Con `p_value` presente: violazione significativa (p < 0,05). Nei risultati più vecchi: massimo oltre 0,05. */
  has_facilitation: boolean;
  /** Avvertenza dell'esperimento su come leggere il risultato. */
  note?: string;
  /** Probabilità di una violazione così grande se il Race Model vale; null se i trial sono troppo pochi. */
  p_value?: number | null;
  /** rate_threshold_crossing: superamento di soglia della frequenza; first_spike_latency: primo spike. */
  method?: 'rate_threshold_crossing' | 'first_spike_latency';
  /** Trial presentati per condizione (n_* conta solo quelli con risposta). */
  trials?: Record<string, number>;
  median_rt_ms?: Record<string, number | null>;
  /** Percentili (5, 15, …, 95) e relativi tempi per condizione; `race` è il Race Model a coppie. */
  percentile_levels?: number[];
  percentiles_ms?: Record<string, number[]>;
  /** A quanti di quei percentili la risposta AV è più veloce del Race Model. */
  percentiles_av_faster_than_race?: number;
}

export interface ResponseAnalysisEntry {
  label: string;
  pop_a: string;
  pop_b: string;
  threshold_hz?: number;
  median_by_condition?: Record<string, number | null>;
  count_by_condition?: Record<string, number>;
  trials_by_condition?: Record<string, number>;
}

export interface SimulationResults extends Simulation {
  raw_file_url: string | null;
  graphs_zip_url: string | null;
  population_graphs: PopulationGraph[];
  differential_graphs: LabelledGraph[];
  race_model_graphs: RaceModelGraph[];
  experiment_graphs: LabelledGraph[];
  response_graphs: ResponseGraph[];
  accuracy_metrics: { metrics: AccuracyMetric[] } | null;
  race_model_data: { race_model: RaceModelResult[] } | null;
  /** Metriche degli esperimenti built-in: la forma dipende dall'esperimento. */
  experiment_metrics: Record<string, any> | null;
  response_analysis: { populations: ResponseAnalysisEntry[] } | null;
}

export const FINAL_STATUSES: SimulationStatus[] = ['COMPLETED', 'FAILED', 'ABORTED'];

export const STATUS_LABELS: Record<SimulationStatus, string> = {
  PENDING: 'In coda',
  RUNNING: 'In corso',
  COMPLETED: 'Completata',
  FAILED: 'Fallita',
  ABORTED: 'Interrotta',
};

/** Classe CSS dello stato (vedi `.status-*` in styles.css). */
export const STATUS_CLASSES: Record<SimulationStatus, string> = {
  PENDING: 'status status-pending',
  RUNNING: 'status status-running',
  COMPLETED: 'status status-completed',
  FAILED: 'status status-failed',
  ABORTED: 'status',
};

/** Esperimenti che costruiscono una rete propria: quella selezionata al lancio non viene simulata. */
const OWN_NETWORK_EXPERIMENTS: ExperimentKind[] = ['cerebellum_conditioning', 'decision_making'];

export function simulatesSelectedNetwork(experiment: ExperimentKind): boolean {
  return !OWN_NETWORK_EXPERIMENTS.includes(experiment);
}

export const OWN_NETWORK_LABEL = "rete interna dell'esperimento";

export const EXPERIMENT_LABELS: Record<ExperimentKind, string> = {
  cerebellum_msi_race: 'Integrazione multisensoriale AV',
  cerebellum_conditioning: 'Condizionamento associativo',
  decision_making: 'Decisione audiovisiva (Wang)',
  trial_protocol: 'Protocollo a trial',
  continuous: 'Simulazione continua',
};

// --- Campagne ---

/** Parametro che varia tra le simulazioni di una campagna: percorso nei parametri di lancio e valori. */
export interface Sweep {
  path: string;
  values: number[];
}

export interface CampaignMember {
  id: number;
  seed: number | null;
  value: number | null;
  status: SimulationStatus;
  error_message: string | null;
}

export interface Campaign {
  id: number;
  name: string;
  network_id: number;
  network_name: string | null;
  experiment: ExperimentKind;
  params: Record<string, any>;
  seeds: number[];
  sweep: Sweep | null;
  /** Chiave del set di riferimento con cui si confrontano i risultati. */
  reference: string | null;
  /** Tempo biologico di tutte le simulazioni insieme. */
  duration_ms: number;
  counts: Record<SimulationStatus, number>;
  created_at: string;
  /** Vuoto negli elenchi, pieno nel dettaglio. */
  simulations: CampaignMember[];
}

export interface ReferenceComparison {
  responses: number;
  median_ms: number | null;
  percentiles_ms: number[];
  /** Differenza tra le mediane (simulato − riferimento); null con troppo pochi tempi. */
  comparison: { difference_ms: number; ci95_ms: [number, number]; differs: boolean } | null;
}

export interface CampaignCondition {
  /** A, V, AV oppure race (Race Model a coppie). */
  label: string;
  trials: number | null;
  responses: number;
  median_ms: number | null;
  ci95_ms: [number, number] | null;
  percentiles_ms: number[];
  reference?: ReferenceComparison;
}

/** Tempi di risposta della stessa popolazione in tutte le simulazioni completate di un valore. */
export interface CampaignGroup {
  population: string;
  note: string | null;
  method: string | null;
  simulations: number;
  conditions: CampaignCondition[];
  percentile_levels: number[];
  percentiles_av_faster_than_race: number | null;
  rmi: { max_violation: number; p_value: number | null; significant: boolean } | null;
  per_simulation: { simulation_id: number; seed: number | null; median_ms: Record<string, number | null> }[];
}

export interface CampaignSummary {
  completed: number;
  reference: string | null;
  points: { value: number | null; groups: CampaignGroup[] }[];
}

export interface ReferenceSet {
  /** "builtin:<chiave>" o "user:<id>". */
  key: string;
  name: string;
  source: string | null;
  responses: Record<string, number>;
  deletable: boolean;
}
