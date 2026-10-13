import copy

from backend.tests.conftest import NETWORK

API = "/api/v1/networks"


def test_create_then_read_returns_the_same_topology(client, auth, network):
    stored = client.get(f"{API}/{network['id']}", headers=auth).json()
    assert stored["definition"]["topology"] == NETWORK["topology"]
    assert [n["id"] for n in client.get(API, headers=auth).json()] == [network["id"]]


def test_update_keeps_projection_params(client, auth, network):
    """Regressione: salvare una rete senza toccarla non deve cambiare indegree e pesi."""
    payload = {**NETWORK, "name": "Rinominata"}
    updated = client.put(f"{API}/{network['id']}", json=payload, headers=auth).json()
    assert updated["name"] == "Rinominata"
    assert updated["definition"]["topology"]["projections"][0]["params"] == {"indegree": 16, "weight": 4.0, "delay": 1.0}


def test_topology_validation(client, auth):
    duplicated = copy.deepcopy(NETWORK)
    duplicated["topology"]["populations"].append(duplicated["topology"]["populations"][0])
    dangling = copy.deepcopy(NETWORK)
    dangling["topology"]["projections"][0]["target"] = "MISSING"
    no_degree = copy.deepcopy(NETWORK)
    del no_degree["topology"]["projections"][0]["params"]["indegree"]
    bad_rule = copy.deepcopy(NETWORK)
    bad_rule["topology"]["projections"][0]["rule"] = "random"
    for payload in (duplicated, dangling, no_degree, bad_rule):
        assert client.post(API, json=payload, headers=auth).status_code == 422


def test_networks_are_private(client, network, other_auth):
    network_id = network["id"]
    assert client.get(f"{API}/{network_id}", headers=other_auth).status_code == 404
    assert client.put(f"{API}/{network_id}", json=NETWORK, headers=other_auth).status_code == 404
    assert client.delete(f"{API}/{network_id}", headers=other_auth).status_code == 404
    assert client.post(f"{API}/{network_id}/fork", headers=other_auth).status_code == 404
    assert client.get(API, headers=other_auth).json() == []


def test_fork_copies_the_definition_and_remembers_the_parent(client, auth, network):
    fork = client.post(f"{API}/{network['id']}/fork", json={"name": "Copia"}, headers=auth).json()
    assert fork["parent_id"] == network["id"]
    assert fork["name"] == "Copia"
    assert fork["definition"] == network["definition"]
    assert fork["description"] == network["description"]
    noted = client.post(f"{API}/{network['id']}/fork", json={"version_notes": "prova con pesi diversi"}, headers=auth).json()
    assert noted["description"] == "prova con pesi diversi"


def test_delete_removes_the_network_and_its_simulations(client, auth, network, minio):
    launched = client.post("/api/v1/simulations/launch", data={"network_id": network["id"], "params": '{"phases": {"test_duration_ms": 100}}'}, headers=auth)
    simulation_id = launched.json()["simulation_id"]
    assert client.delete(f"{API}/{network['id']}", headers=auth).status_code == 204
    assert client.get(f"{API}/{network['id']}", headers=auth).status_code == 404
    assert client.get(f"/api/v1/simulations/{simulation_id}", headers=auth).status_code == 404


def test_model_catalogue_lists_the_reference_models(client, auth):
    catalogue = client.get(f"{API}/models", headers=auth).json()
    neuron_ids = {neuron["id"] for module in catalogue["modules"] for neuron in module["neurons"]}
    assert {"iaf_cond_exp", "parrot_neuron", "poisson_generator", "dc_generator"} <= neuron_ids
    assert {device["id"] for device in catalogue["stimulus_devices"]} >= {"legacy_sensory_stimulus", "spike_train_stimulus"}


def test_dates_are_returned_as_utc(network):
    assert network["created_at"].endswith(("Z", "+00:00"))
