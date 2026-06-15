/**
 * MuSiN Preset Library
 * --------------------
 * Validated, ready-to-run building blocks so that clinicians, medical students
 * and new researchers can reproduce canonical cerebellar experiments without
 * hand-authoring NEST topology or stimulus JSON from a blank form.
 *
 * - NETWORK_PRESETS feed the Network Builder (params are pretty-printed JSON
 *   strings, matching the builder's reactive-form controls).
 * - PROTOCOL_PRESETS feed the Simulation Runner (experiment-payload shape,
 *   identical to the "Clone & Relaunch" state object).
 *
 * Scientific basis:
 *   - Cerebellar microcircuit: GR → PC → DCN with IO teaching signal, split
 *     into two competing pathways (A / B). Mirrors test/network.py.
 *   - Associative (eyeblink-style) conditioning protocol: test/simulation.py.
 *   - Audiovisual multisensory integration with Race Model Inequality:
 *     Cavadini et al. 2025 (APL Bioengineering) — computational model; replicates
 *     Ronconi et al. 2017 (Cerebral Cortex); Miller 1982 race model.
 */

export interface NetworkPresetPopulation {
  id: string;
  size: number;
  neuron_model: string;
  params: string; // pretty JSON string for the builder textarea
}

export interface NetworkPresetProjection {
  source: string;
  target: string;
  rule: string;
  indegree?: number;
  outdegree?: number;
  synapse_model: string;
  params: string; // pretty JSON string (without indegree/outdegree)
}

export interface NetworkPreset {
  key: string;
  name: string;
  tagline: string;
  description: string;
  audience: 'clinical' | 'research' | 'both';
  biological_params: string;
  populations: NetworkPresetPopulation[];
  projections: NetworkPresetProjection[];
}

export interface ProtocolPreset {
  key: string;
  name: string;
  tagline: string;
  description: string;
  audience: 'clinical' | 'research' | 'both';
  /** Population IDs this protocol expects to exist in the target network. */
  requiresPopulations: string[];
  /** Experiment payload — same shape consumed by applyClonedParams(). */
  payload: any;
}

const j = (o: unknown) => JSON.stringify(o, null, 2);

/* ============================================================
   NETWORK PRESETS
   ============================================================ */

export const NETWORK_PRESETS: NetworkPreset[] = [
  {
    key: 'cerebellar_microcircuit_ab',
    name: 'Cerebellar Microcircuit (GR→PC→DCN, vie A/B)',
    tagline: 'Microcircuito cerebellare canonico con segnale di insegnamento IO (2500 neuroni)',
    audience: 'both',
    description:
      'The validated cerebellar microcircuit used for associative learning and ' +
      'decision experiments. Granule cells (GR) drive two competing Purkinje → DCN ' +
      'pathways (A and B). Each Purkinje population receives an Inferior Olive (IO) ' +
      'teaching signal via climbing fibers. EGLIF pacemaker cells fire tonically (~40 Hz) ' +
      'as in biology; plastic PF→PC synapses (STDP) support learning.',
    biological_params: j({ LTP1: 0.001, LTD1: 0.02, Init_PFPC: 4.0 }),
    populations: [
      {
        id: 'GR',
        size: 2000,
        neuron_model: 'iaf_cond_exp',
        params: j({
          t_ref: 1.0, C_m: 2.0, V_th: -40.0, V_reset: -70.0,
          E_L: -70.0, g_L: 0.2, tau_syn_ex: 0.5, tau_syn_in: 10.0,
        }),
      },
      { id: 'PC_A',  size: 100, neuron_model: 'eglif_pc_nestml',  params: '{}' },
      { id: 'PC_B',  size: 100, neuron_model: 'eglif_pc_nestml',  params: '{}' },
      { id: 'IO_A',  size: 100, neuron_model: 'eglif_io_nestml',  params: '{}' },
      { id: 'IO_B',  size: 100, neuron_model: 'eglif_io_nestml',  params: '{}' },
      { id: 'DCN_A', size: 50,  neuron_model: 'eglif_dcnp',       params: '{}' },
      { id: 'DCN_B', size: 50,  neuron_model: 'eglif_dcnp',       params: '{}' },
    ],
    projections: [
      {
        source: 'GR', target: 'PC_A', rule: 'fixed_indegree', indegree: 160,
        synapse_model: 'static_synapse',
        params: j({ weight: 4.0, receptor_type: 1 }),
      },
      {
        source: 'GR', target: 'PC_B', rule: 'fixed_indegree', indegree: 160,
        synapse_model: 'static_synapse',
        params: j({ weight: 4.0, receptor_type: 1 }),
      },
      {
        source: 'IO_A', target: 'PC_A', rule: 'one_to_one',
        synapse_model: 'static_synapse', params: j({ weight: 1.0, receptor_type: 5 }),
      },
      {
        source: 'IO_B', target: 'PC_B', rule: 'one_to_one',
        synapse_model: 'static_synapse', params: j({ weight: 1.0, receptor_type: 5 }),
      },
      {
        source: 'PC_A', target: 'DCN_A', rule: 'fixed_outdegree', outdegree: 1,
        synapse_model: 'static_synapse', params: j({ weight: 10.0, receptor_type: 2 }),
      },
      {
        source: 'PC_B', target: 'DCN_B', rule: 'fixed_outdegree', outdegree: 1,
        synapse_model: 'static_synapse', params: j({ weight: 10.0, receptor_type: 2 }),
      },
    ],
  },
];

/* ============================================================
   PROTOCOL PRESETS
   ============================================================ */

// Shared device/connection wiring for the A/B cerebellar circuit.
const ab_sensory_devices = [
  { id: 'CS_A1', model: 'legacy_sensory_stimulus', params: { rate: 20.0, n_sources: 20 } },
  { id: 'CS_A2', model: 'legacy_sensory_stimulus', params: { rate: 20.0, n_sources: 20 } },
  { id: 'CS_B1', model: 'legacy_sensory_stimulus', params: { rate: 20.0, n_sources: 20 } },
  { id: 'CS_B2', model: 'legacy_sensory_stimulus', params: { rate: 20.0, n_sources: 20 } },
  { id: 'US_A', model: 'legacy_sensory_stimulus', params: { rate: 8.5, n_sources: 10 } },
  { id: 'US_B', model: 'legacy_sensory_stimulus', params: { rate: 8.5, n_sources: 10 } },
];

const ab_connections = [
  { source: 'CS_A1', target: 'GR', rule: 'fixed_indegree', synapse_model: 'static_synapse', params: { indegree: 1, weight: 1.2, delay: 1.0 } },
  { source: 'CS_A2', target: 'GR', rule: 'fixed_indegree', synapse_model: 'static_synapse', params: { indegree: 1, weight: 1.2, delay: 1.0 } },
  { source: 'CS_B1', target: 'GR', rule: 'fixed_indegree', synapse_model: 'static_synapse', params: { indegree: 1, weight: 1.2, delay: 1.0 } },
  { source: 'CS_B2', target: 'GR', rule: 'fixed_indegree', synapse_model: 'static_synapse', params: { indegree: 1, weight: 1.2, delay: 1.0 } },
  { source: 'CS_A1', target: 'DCN_A', rule: 'all_to_all', synapse_model: 'static_synapse', params: { weight: 0.6, delay: 20.0, receptor_type: 1 } },
  { source: 'CS_B1', target: 'DCN_B', rule: 'all_to_all', synapse_model: 'static_synapse', params: { weight: 0.6, delay: 20.0, receptor_type: 1 } },
  { source: 'US_A', target: 'IO_A', rule: 'all_to_all', synapse_model: 'static_synapse', params: { weight: 1.0, delay: 1.0, receptor_type: 1 } },
  { source: 'US_B', target: 'IO_B', rule: 'all_to_all', synapse_model: 'static_synapse', params: { weight: 1.0, delay: 1.0, receptor_type: 1 } },
];

export const PROTOCOL_PRESETS: ProtocolPreset[] = [
  {
    key: 'associative_conditioning_ab',
    name: 'Associative Conditioning (A vs B)',
    tagline: 'Eyeblink-style CS/US conditioning across two pathways',
    audience: 'both',
    requiresPopulations: ['GR', 'DCN_A', 'DCN_B', 'IO_A', 'IO_B'],
    description:
      'Classic associative-learning protocol. Each trial randomly presents either the ' +
      'A bundle (CS_A + US_A) or the B bundle (CS_B + US_B). Conditioned stimuli drive ' +
      'granule cells; unconditioned stimuli drive the inferior olive (teaching signal). ' +
      'The differential DCN_A − DCN_B readout reveals which pathway the cerebellum has learned.',
    payload: {
      resolution: 0.1,
      seed: 1234,
      protocol: {
        num_trials: 30,
        trial_duration_ms: 1000.0,
        stimulus_duration_ms: 300.0,
        iti_range_ms: [1000, 2000],
        iti_ms: 1500,
        stimuli_pool: [
          { devices: ['CS_A1', 'CS_A2', 'US_A'], weight: 1.0, condition_label: 'A' },
          { devices: ['CS_B1', 'CS_B2', 'US_B'], weight: 1.0, condition_label: 'B' },
        ],
      },
      inputs: { devices: ab_sensory_devices, connections: ab_connections },
      analysis: {
        differential_plots: [
          { pop_a: 'DCN_A', pop_b: 'DCN_B', label: 'Motor Decision (DCN)' },
        ],
        response_cdf: { enabled: true, threshold: 15.0, bin_size: 5.0 },
      },
    },
  },
  {
    key: 'audiovisual_msi_train_test',
    name: 'AV Multisensory Integration — Train + Test',
    tagline: 'Cerebellar STDP conditioning → Race Model Inequality (full in-silico replication)',
    audience: 'research',
    requiresPopulations: ['GR', 'PC_A', 'PC_B', 'IO_A', 'IO_B', 'DCN_A', 'DCN_B'],
    description:
      'Full in-silico replication of audiovisual multisensory integration with cerebellar learning. ' +
      'Phase 1 (Training, STDP ON): CS→GR→PC_A (STDP LTD) + US_A→IO_A (climbing-fiber teaching signal) ' +
      'trains DCN_A to respond to sensory input via cerebellar disinhibition. ' +
      'Phase 2 (Test, STDP OFF): V / A / AV / CATCH trials; Race Model Inequality (Miller 1982) ' +
      'computed on DCN_A reaction times (rate-threshold crossings) to test for genuine ' +
      'multisensory facilitation. Use with the "Cerebellar Microcircuit (A/B)" network.',
    payload: {
      builtin: 'cerebellum_msi_race',
      seed: 2016,
      resolution: 0.1,
      train: {
        n_trials: 45,
        trial_duration_ms: 1000,
        stimulus_duration_ms: 300,
        iti_range_ms: [500, 1000],
        cs_rate: 20.0,
        cs_n_sources: 20,
        us_rate: 8.5,
        us_n_sources: 10,
      },
      test: {
        n_trials: 100,
        trial_duration_ms: 1000,
        stimulus_duration_ms: 600,
        iti_range_ms: [200, 400],
        vis_rate: 20.0,
        aud_rate: 20.0,
        n_sources: 20,
        aud_latency_ms: 180,
        vis_latency_ms: 220,
        mf_dcn_weight_low: 0.34,
        mf_dcn_weight_high: 0.40,
        response: { bin_ms: 5.0, smooth_bins: 5, baseline_ms: 200.0, threshold_delta_hz: 15.0 },
      },
    },
  },
];

export function getNetworkPreset(key: string): NetworkPreset | undefined {
  return NETWORK_PRESETS.find((p) => p.key === key);
}

export function getProtocolPreset(key: string): ProtocolPreset | undefined {
  return PROTOCOL_PRESETS.find((p) => p.key === key);
}
