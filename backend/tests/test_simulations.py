import json

import pytest

from backend.core.db import SessionLocal
from backend.models import Simulation, SimulationStatus

API = "/api/v1/simulations"
CONTINUOUS = {"phases": {"train_duration_ms": 0, "test_duration_ms": 500}}


def launch(client, auth, network, params=CONTINUOUS, **form):
    raw = params if isinstance(params, str) else json.dumps(params)
    return client.post(f"{API}/launch", data={"network_id": network["id"], "params": raw, **form}, headers=auth)


def set_status(simulation_id, status, results_path=None):
    with SessionLocal() as db:
        simulation = db.get(Simulation, simulation_id)
        simulation.status = status
        simulation.results_path = results_path
        db.commit()


def test_launch_creates_a_pending_simulation_and_queues_it(client, auth, network, queued_tasks):
    response = launch(client, auth, network, name="Prova")
    assert response.status_code == 201
    simulation_id = response.json()["simulation_id"]
    assert queued_tasks == [simulation_id]
    simulation = client.get(f"{API}/{simulation_id}", headers=auth).json()
    assert (simulation["status"], simulation["experiment"], simulation["name"]) == ("PENDING", "continuous", "Prova")
    assert simulation["duration_ms"] == 500
    assert simulation["network_name"] == network["name"]


@pytest.mark.parametrize("params", [
    "not json",
    "[1, 2]",
    {},                                                    # durata zero
    {"phases": {"test_duration_ms": 10_000_000}},          # oltre il tetto
    {"protocol": {"num_trials": "many"}},
    {"builtin": "does_not_exist"},
    {"phases": "soon"},
    '{"phases": {"test_duration_ms": NaN}}',               # NaN non è JSON
    '{"phases": {"test_duration_ms": Infinity}}',
    {"phases": {"train_duration_ms": -100, "test_duration_ms": 200}},
])
def test_launch_rejects_invalid_params(client, auth, network, queued_tasks, params):
    assert launch(client, auth, network, params).status_code == 422
    assert queued_tasks == []


def test_launch_rejects_malformed_or_foreign_network_ids(client, auth, other_auth, network):
    assert client.post(f"{API}/launch", data={"network_id": "abc", "params": "{}"}, headers=auth).status_code == 422
    assert launch(client, other_auth, network).status_code == 404


def test_spike_train_devices_must_point_to_an_owned_stimulus(client, auth, network):
    params = {**CONTINUOUS, "inputs": {"devices": [{"id": "S", "model": "spike_train_stimulus", "params": {"stimulus_id": 99999}}]}}
    assert launch(client, auth, network, params).status_code == 422


def test_list_is_paginated_newest_first_with_counts(client, auth, network):
    ids = [launch(client, auth, network).json()["simulation_id"] for _ in range(3)]
    set_status(ids[0], SimulationStatus.COMPLETED)
    page = client.get(API, params={"limit": 2}, headers=auth).json()
    assert [item["id"] for item in page["items"]] == [ids[2], ids[1]]
    assert page["total"] == 3
    assert (page["counts"]["PENDING"], page["counts"]["COMPLETED"]) == (2, 1)
    second = client.get(API, params={"limit": 2, "skip": 2}, headers=auth).json()
    assert [item["id"] for item in second["items"]] == [ids[0]]
    completed = client.get(API, params={"status": "COMPLETED"}, headers=auth).json()
    assert completed["total"] == 1 and completed["counts"]["PENDING"] == 2


def test_abort_marks_the_simulation_and_cannot_be_repeated(client, auth, network):
    simulation_id = launch(client, auth, network).json()["simulation_id"]
    assert client.post(f"{API}/{simulation_id}/abort", headers=auth).json()["status"] == "ABORTED"
    assert client.get(f"{API}/{simulation_id}/status", headers=auth).json()["status"] == "ABORTED"
    assert client.post(f"{API}/{simulation_id}/abort", headers=auth).status_code == 400


def test_simulations_are_private_and_ids_are_validated(client, auth, other_auth, network):
    simulation_id = launch(client, auth, network).json()["simulation_id"]
    for path in ("", "/status", "/results"):
        assert client.get(f"{API}/{simulation_id}{path}", headers=other_auth).status_code == 404
    assert client.post(f"{API}/{simulation_id}/abort", headers=other_auth).status_code == 404
    assert client.get(f"{API}/abc/status", headers=auth).status_code == 422


def test_results_are_built_from_the_files_the_worker_produced(client, auth, network, files):
    simulation_id = launch(client, auth, network).json()["simulation_id"]
    assert client.get(f"{API}/{simulation_id}/results", headers=auth).status_code == 404  # non ancora completata

    base = f"results/1/sim_{simulation_id}"
    for name in ("PC_A_raster.png", "PC_A_histogram.png", "GR_raster.png", "pop_X_raster.png",
                 "exp_cond_raster.png", "diff_GR_PC_A.png",
                 "diff_DCN_A__DCN_B.png", "rmi_DCN_A.png", "exp_cond_weights.png",
                 "activation_test_DCN_AB.png", "cdf_test_DCN_AB.png", "spikes.json"):
        files.write(f"{base}/{name}", b"x")
    files.write(f"{base}/accuracy_metrics.json", b'{"metrics": []}')
    set_status(simulation_id, SimulationStatus.COMPLETED, base)

    results = client.get(f"{API}/{simulation_id}/results", headers=auth).json()
    # Ordine della rete (GR, PC_A), poi le popolazioni che la rete non ha.
    assert [g["population_id"] for g in results["population_graphs"]] == ["GR", "PC_A", "pop_X"]
    assert results["population_graphs"][0]["histogram_url"] is None
    assert "/PC_A_histogram.png?" in results["population_graphs"][1]["histogram_url"]
    # Il nome nuovo (doppio underscore) e quello dei risultati vecchi danno la stessa etichetta.
    assert [g["label"] for g in results["differential_graphs"]] == ["DCN_A − DCN_B", "GR − PC_A"]
    assert results["race_model_graphs"][0]["population"] == "DCN_A"
    assert [g["label"] for g in results["experiment_graphs"]] == ["cond raster", "cond weights"]
    assert {(g["kind"], g["pair"]) for g in results["response_graphs"]} == {("activation", "test_DCN_AB"), ("cdf", "test_DCN_AB")}
    assert results["accuracy_metrics"] == {"metrics": []}
    assert results["race_model_data"] is None
    assert results["graphs_zip_url"] is None and "/spikes.json?" in results["raw_file_url"]
    # I link sono scaricabili senza token, come li usa un tag <img>.
    assert client.get(results["raw_file_url"]).content == b"x"


def test_delete_removes_only_that_simulation_results(client, auth, network, files):
    """Regressione: eliminare sim_1 cancellava anche i file di sim_10, sim_11, ..."""
    simulation_id = launch(client, auth, network).json()["simulation_id"]
    base = f"results/1/sim_{simulation_id}"
    files.write(f"{base}/spikes.json", b"x")
    files.write(f"{base}0/spikes.json", b"other simulation")
    set_status(simulation_id, SimulationStatus.COMPLETED, base)

    assert client.delete(f"{API}/{simulation_id}", headers=auth).status_code == 204
    assert files.list("results") == [f"{base}0/spikes.json"]
    assert client.get(f"{API}/{simulation_id}", headers=auth).status_code == 404


def test_stimuli_uploaded_before_the_library_cannot_be_replayed(client, auth, network):
    from backend.core.db import SessionLocal
    from backend.models import Stimulus

    owner_id = client.get("/api/v1/auth/me", headers=auth).json()["id"]
    with SessionLocal() as db:
        legacy = Stimulus(name="vecchio", file_path="stimuli/1/raw.h5", owner_id=owner_id)
        db.add(legacy)
        db.commit()
        legacy_id = legacy.id
    params = {**CONTINUOUS, "inputs": {"devices": [{"id": "S", "model": "spike_train_stimulus", "params": {"stimulus_id": legacy_id}}]}}
    response = launch(client, auth, network, params)
    assert response.status_code == 422
    assert "caricalo di nuovo" in response.json()["detail"]


def test_a_simulation_keeps_the_network_it_was_launched_with(client, auth, network):
    """Modificare la rete dopo il lancio non cambia ciò che la simulazione calcola."""
    simulation_id = launch(client, auth, network).json()["simulation_id"]
    edited = {"name": "Rete modificata", "topology": {"populations": [{"id": "X", "size": 1, "neuron_model": "iaf_cond_exp"}], "projections": []}}
    assert client.put(f"/api/v1/networks/{network['id']}", json=edited, headers=auth).status_code == 200
    with SessionLocal() as db:
        snapshot = db.get(Simulation, simulation_id).network_definition
    assert [pop["id"] for pop in snapshot["topology"]["populations"]] == ["GR", "PC_A"]
