"""Un giro minimo di ogni esperimento con NEST vero. Saltato dove NEST non è installato
(la CI): nell'immagine del simulatore gira con il resto della suite."""
import json

import pytest

pytest.importorskip("nest")

from backend.services.experiments import estimate_duration_ms
from backend.services.storage import FileStorage
from worker.tasks import EXPERIMENTS, experiment_kind

CELL = {"t_ref": 1.0, "C_m": 2.0, "V_th": -40.0, "V_reset": -70.0, "E_L": -70.0, "g_L": 0.2, "tau_syn_ex": 0.5, "tau_syn_in": 10.0}
PURKINJE = {"t_ref": 2.0, "C_m": 400.0, "V_th": -52.0, "V_reset": -70.0, "E_L": -70.0, "g_L": 16.0, "tau_syn_ex": 0.5, "tau_syn_in": 1.6}
CEREBELLUM = {"topology": {
    "populations": [
        {"id": "GR", "size": 400, "neuron_model": "iaf_cond_exp", "params": CELL},
        {"id": "PC_A", "size": 20, "neuron_model": "iaf_cond_exp", "params": PURKINJE},
        {"id": "PC_B", "size": 20, "neuron_model": "iaf_cond_exp", "params": PURKINJE},
        {"id": "IO_A", "size": 20, "neuron_model": "parrot_neuron", "params": {}},
        {"id": "DCN_A", "size": 10, "neuron_model": "iaf_cond_exp", "params": CELL},
        {"id": "DCN_B", "size": 10, "neuron_model": "iaf_cond_exp", "params": CELL},
    ],
    "projections": [
        {"source": "GR", "target": "PC_A", "rule": "fixed_indegree", "params": {"indegree": 160, "weight": 4.0, "delay": 1.0}},
        {"source": "GR", "target": "PC_B", "rule": "fixed_indegree", "params": {"indegree": 160, "weight": 4.0, "delay": 1.0}},
        {"source": "PC_A", "target": "DCN_A", "rule": "fixed_outdegree", "params": {"outdegree": 1, "weight": -20.0, "delay": 1.0}},
        {"source": "PC_B", "target": "DCN_B", "rule": "fixed_outdegree", "params": {"outdegree": 1, "weight": -20.0, "delay": 1.0}},
    ],
}}
INPUTS = {
    "devices": [{"id": "S", "model": "poisson_generator", "params": {"rate": 2000.0}}],
    "connections": [{"source": "S", "target": "GR", "rule": "all_to_all", "params": {"weight": 1.0, "delay": 1.0}}],
}

RUNS = {
    "continuous": {"phases": {"train_duration_ms": 50, "test_duration_ms": 100}, "inputs": INPUTS},
    "trial_protocol": {
        "protocol": {"num_trials": 4, "trial_duration_ms": 300, "stimulus_duration_ms": 150,
                     "stimuli_pool": [{"devices": ["S"], "weight": 1, "condition_label": "S"}]},
        "inputs": INPUTS,
    },
    "cerebellum_msi_race": {"builtin": "cerebellum_msi_race", "train": {"n_trials": 3}, "test": {"n_trials": 8}},
    "cerebellum_conditioning": {"builtin": "cerebellum_conditioning", "n_train": 2, "n_test": 2},
    "decision_making": {"builtin": "decision_making", "decision_making": {"order": 100, "num_trials": 2}},
}


@pytest.mark.parametrize("kind", RUNS)
def test_experiment_runs_and_writes_its_results(kind, tmp_path):
    import importlib

    params = {**RUNS[kind], "seed": 7}
    assert experiment_kind(params) == kind
    estimate_duration_ms(params)
    files = FileStorage(tmp_path)
    phases = []
    module_name, function_name = EXPERIMENTS[kind]
    run = getattr(importlib.import_module(module_name), function_name)
    run({"owner_id": 1, "sim_id": 1, "network_definition": CEREBELLUM, "load_stimulus": None}, params, files,
        lambda percent, phase: phases.append(percent))

    written = {name.rsplit("/", 1)[-1] for name in files.list("results/1/sim_1")}
    assert {"spikes.json", "graphs.zip"} <= written, written
    assert any(name.endswith(".png") for name in written)
    assert phases and max(phases) <= 100
    spikes = files.read_json("results/1/sim_1/spikes.json")["spikes"]
    assert any(len(events["times"]) for events in spikes.values()), "la rete non ha mai scaricato"
    if "builtin" in params:
        race = json.dumps(files.read_json("results/1/sim_1/race_model.json"))
        assert "p_value" in race and "has_facilitation" in race
