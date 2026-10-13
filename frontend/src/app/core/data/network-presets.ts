import { NetworkPayload, Population, Projection } from '../models';
import { countNeurons, countSynapses } from '../utils/topology';

export interface NetworkPreset {
  key: string;
  name: string;
  description: string;
  populations: Population[];
  projections: Projection[];
}

// Parametri dei neuroni del modello di riferimento (cerebellum_simple.py):
// integrate-and-fire a conduttanza, senza attività spontanea.
const GRANULE = { t_ref: 1.0, C_m: 2.0, V_th: -40.0, V_reset: -70.0, E_L: -70.0, g_L: 0.2, tau_syn_ex: 0.5, tau_syn_in: 10.0 };
const PURKINJE = { t_ref: 2.0, C_m: 400.0, V_th: -52.0, V_reset: -70.0, E_L: -70.0, g_L: 16.0, tau_syn_ex: 0.5, tau_syn_in: 1.6 };
const NUCLEAR = { t_ref: 1.0, C_m: 2.0, V_th: -40.0, V_reset: -70.0, E_L: -70.0, g_L: 0.2, tau_syn_ex: 0.5, tau_syn_in: 10.0 };

const parallelFibre = (target: string): Projection => ({
  source: 'GR',
  target,
  rule: 'fixed_indegree',
  synapse_model: 'static_synapse',
  params: { indegree: 160, weight: 4.0, delay: 1.0 },
});

// iaf_cond_exp sceglie la conduttanza inibitoria dal segno del peso.
const purkinjeInhibition = (source: string, target: string): Projection => ({
  source,
  target,
  rule: 'fixed_outdegree',
  synapse_model: 'static_synapse',
  params: { outdegree: 1, weight: -20.0, delay: 1.0 },
});

export const NETWORK_PRESETS: NetworkPreset[] = [
  {
    key: 'cerebellar_microcircuit_ab',
    name: 'Microcircuito cerebellare (vie A/B)',
    description:
      'GR → PC → DCN su due vie in competizione, con oliva inferiore come segnale di insegnamento. ' +
      "È la rete richiesta dall'esperimento di integrazione multisensoriale AV.",
    populations: [
      { id: 'GR', size: 2000, neuron_model: 'iaf_cond_exp', params: GRANULE },
      { id: 'PC_A', size: 100, neuron_model: 'iaf_cond_exp', params: PURKINJE },
      { id: 'PC_B', size: 100, neuron_model: 'iaf_cond_exp', params: PURKINJE },
      { id: 'IO_A', size: 100, neuron_model: 'parrot_neuron', params: {} },
      { id: 'IO_B', size: 100, neuron_model: 'parrot_neuron', params: {} },
      { id: 'DCN_A', size: 50, neuron_model: 'iaf_cond_exp', params: NUCLEAR },
      { id: 'DCN_B', size: 50, neuron_model: 'iaf_cond_exp', params: NUCLEAR },
    ],
    projections: [
      parallelFibre('PC_A'),
      parallelFibre('PC_B'),
      purkinjeInhibition('PC_A', 'DCN_A'),
      purkinjeInhibition('PC_B', 'DCN_B'),
    ],
  },
];

export function presetToPayload(preset: NetworkPreset): NetworkPayload {
  return {
    name: preset.name,
    description: preset.description,
    nodes_count: countNeurons(preset.populations),
    edges_count: countSynapses(preset.populations, preset.projections),
    params: {},
    topology: { populations: preset.populations, projections: preset.projections },
  };
}
