"""Catalogo dei modelli NEST proposti dall'editor di rete, con i parametri di default."""

SENSORY_STIMULUS = "legacy_sensory_stimulus"
SPIKE_TRAIN_STIMULUS = "spike_train_stimulus"

CONNECTION_RULES = ("all_to_all", "one_to_one", "fixed_indegree", "fixed_outdegree", "pairwise_bernoulli")

_STATIC_SYNAPSE = {"id": "static_synapse", "label": "Sinapsi statica", "default_params": {"weight": 1.0, "delay": 1.0}}

MODEL_CATALOGUE = {
    "modules": [
        {
            "id": "nest_standard",
            "label": "NEST standard",
            "description": "Modelli forniti da NEST Simulator.",
            "neurons": [
                {
                    "id": "iaf_cond_exp",
                    "label": "Integrate-and-fire a conduttanza (esponenziale)",
                    "default_params": {"E_L": -70.0, "C_m": 250.0, "g_L": 16.7, "t_ref": 2.0, "V_th": -55.0, "V_reset": -60.0, "tau_syn_ex": 0.2, "tau_syn_in": 2.0},
                },
                {
                    "id": "iaf_psc_alpha",
                    "label": "Integrate-and-fire a corrente (alpha)",
                    "default_params": {"V_m": -70.0, "E_L": -70.0, "C_m": 250.0, "tau_m": 10.0, "t_ref": 2.0, "V_th": -55.0, "V_reset": -70.0},
                },
                {
                    "id": "iaf_psc_exp",
                    "label": "Integrate-and-fire a corrente (esponenziale)",
                    "default_params": {"V_m": -70.0, "E_L": -70.0, "C_m": 250.0, "tau_m": 10.0, "t_ref": 2.0, "V_th": -55.0, "V_reset": -70.0},
                },
                {
                    "id": "hh_psc_alpha",
                    "label": "Hodgkin-Huxley",
                    "default_params": {"V_m": -65.0, "E_L": -65.0, "C_m": 100.0, "t_ref": 2.0},
                },
                {"id": "parrot_neuron", "label": "Parrot (ripetitore)", "default_params": {}},
            ],
            "synapses": [
                _STATIC_SYNAPSE,
                {
                    "id": "stdp_synapse",
                    "label": "STDP",
                    "default_params": {"weight": 1.0, "delay": 1.0, "lambda": 0.01, "alpha": 1.0, "mu_plus": 1.0, "mu_minus": 1.0},
                },
            ],
        },
        {
            "id": "nest_generators",
            "label": "Generatori (come popolazione della rete)",
            "description": "Generatori NEST salvati con la rete: sempre attivi, non seguono il protocollo a trial.",
            "neurons": [
                {"id": "poisson_generator", "label": "Generatore di Poisson", "default_params": {"rate": 20.0}},
                {"id": "dc_generator", "label": "Generatore di corrente continua", "default_params": {"amplitude": 100.0}},
            ],
            "synapses": [],
        },
        {
            "id": "cerebnest",
            "label": "CerebNEST (cervelletto)",
            "description": "Modelli EGLIF del microcircuito cerebellare.",
            "neurons": [
                {"id": "eglif_cond_alpha_multisyn", "label": "Granulo / Golgi (EGLIF)", "default_params": {"V_m": -70.0, "C_m": 2.0}},
                {"id": "eglif_pc_nestml", "label": "Purkinje (EGLIF)", "default_params": {"V_m": -60.0, "C_m": 250.0}},
                {"id": "eglif_mli", "label": "Interneurone dello strato molecolare (EGLIF)", "default_params": {"V_m": -60.0, "C_m": 15.0}},
                {"id": "eglif_io_nestml", "label": "Oliva inferiore (EGLIF)", "default_params": {"V_m": -60.0, "C_m": 100.0}},
                {"id": "eglif_dcnp", "label": "Nucleo cerebellare profondo (EGLIF)", "default_params": {"V_m": -60.0, "C_m": 150.0}},
            ],
            "synapses": [_STATIC_SYNAPSE],
        },
    ],
    # Generatori collegabili alle popolazioni dal pannello di simulazione.
    "stimulus_devices": [
        {
            "id": SENSORY_STIMULUS,
            "label": "Stimolo sensoriale (Poisson)",
            "description": "Treni di Poisson indipendenti, attivi solo nei trial la cui condizione include il dispositivo.",
            "default_params": {"rate": 20.0, "n_sources": 20},
        },
        {
            "id": SPIKE_TRAIN_STIMULUS,
            "label": "Treni di spike da file",
            "description": "Riproduce i treni di uno stimolo caricato nella libreria.",
            "default_params": {"stimulus_id": None},
        },
        {"id": "poisson_generator", "label": "Generatore di Poisson", "default_params": {"rate": 20.0}},
        {"id": "dc_generator", "label": "Generatore di corrente continua", "default_params": {"amplitude": 100.0}},
    ],
}
