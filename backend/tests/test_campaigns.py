import numpy as np
import pytest

from backend.core.db import SessionLocal
from backend.models import Campaign, Simulation, SimulationStatus
from backend.services.campaigns import CampaignError, expand, summarise, summarise_group

API = "/api/v1/campaigns"
CONDITIONING = {"builtin": "cerebellum_conditioning", "n_train": 2, "n_test": 3, "seed": 7}
DECISION = {"builtin": "decision_making", "decision_making": {"modality": "dual", "num_trials": 4}}


def create(client, auth, network, **body):
    payload = {"network_id": network["id"], "params": CONDITIONING, "seeds": [11, 12, 13], **body}
    return client.post(API, json=payload, headers=auth)


def complete(files, simulation_id, entry):
    """Chiude una simulazione come farebbe il worker, con i tempi di risposta dati."""
    with SessionLocal() as db:
        simulation = db.get(Simulation, simulation_id)
        simulation.status = SimulationStatus.COMPLETED
        simulation.results_path = f"results/{simulation.owner_id}/sim_{simulation_id}"
        db.commit()
        path = simulation.results_path
    files.write_json(f"{path}/race_model.json", {"race_model": [entry]})
    return path


def entry(shift=0.0, population="DCN"):
    rng = np.random.default_rng(int(shift) + 1)
    auditory, visual = rng.normal(320 + shift, 40, 20), rng.normal(370 + shift, 40, 20)
    return {
        "population": population,
        "trials": {"V": 20, "A": 20, "AV": 20},
        "reaction_times_ms": {
            "A": [round(float(x), 1) for x in auditory], "V": [round(float(x), 1) for x in visual],
            "AV": [245.0] * 20, "race": [round(float(x), 1) for x in np.minimum(auditory, visual)],
        },
    }


def test_a_campaign_creates_one_queued_simulation_per_seed(client, auth, network, queued_tasks):
    response = create(client, auth, network, name="Tre seed")
    assert response.status_code == 201, response.text
    campaign = response.json()
    assert (campaign["name"], campaign["experiment"], campaign["counts"]["PENDING"]) == ("Tre seed", "cerebellum_conditioning", 3)
    assert [member["seed"] for member in campaign["simulations"]] == [11, 12, 13]
    assert queued_tasks == [member["id"] for member in campaign["simulations"]]
    assert campaign["duration_ms"] == 3 * (2 + 3 * 3) * 3000

    with SessionLocal() as db:
        params = [db.get(Simulation, member["id"]).experiment_params for member in campaign["simulations"]]
    assert [p["seed"] for p in params] == [11, 12, 13]
    assert all(p["save_spikes"] is False and p["n_test"] == 3 for p in params)   # gli spike non si salvano
    assert CONDITIONING["seed"] == 7                                             # il modello non viene toccato

    # Le simulazioni di una campagna non affollano l'elenco delle simulazioni: stanno nella campagna.
    listing = client.get("/api/v1/simulations", headers=auth).json()
    assert (listing["total"], sum(listing["counts"].values())) == (0, 0)
    assert [c["id"] for c in client.get(API, headers=auth).json()] == [campaign["id"]]
    member = client.get(f"/api/v1/simulations/{campaign['simulations'][0]['id']}", headers=auth).json()
    assert member["campaign_id"] == campaign["id"]


def test_the_decision_network_keeps_its_seed_in_its_own_section(client, auth, network):
    campaign = create(client, auth, network, params=DECISION, seeds=[5, 6], save_spikes=True).json()
    with SessionLocal() as db:
        params = [db.get(Simulation, member["id"]).experiment_params for member in campaign["simulations"]]
    assert [p["decision_making"]["seed"] for p in params] == [5, 6]
    assert all("seed" not in p and p["save_spikes"] is True for p in params)


def test_a_swept_parameter_multiplies_the_simulations(client, auth, network, queued_tasks):
    sweep = {"path": "aud_latency_ms", "values": [150, 180]}
    campaign = create(client, auth, network, seeds=[1, 2], sweep=sweep).json()
    assert [(m["value"], m["seed"]) for m in campaign["simulations"]] == [(150, 1), (150, 2), (180, 1), (180, 2)]
    assert len(queued_tasks) == 4
    with SessionLocal() as db:
        stored = db.get(Simulation, campaign["simulations"][0]["id"]).experiment_params["aud_latency_ms"]
    assert stored == 150 and isinstance(stored, int)      # 150.0 farebbe fallire i parametri interi
    nested = {"path": "decision_making.auditory_latency_ms", "values": [150, 180, 210]}
    assert len(create(client, auth, network, params=DECISION, seeds=[1], sweep=nested).json()["simulations"]) == 3


@pytest.mark.parametrize("body", [
    {"seeds": []},
    {"seeds": [1, 1]},
    {"seeds": [-1]},
    {"seeds": list(range(51))},
    {"seeds": list(range(10)), "sweep": {"path": "aud_latency_ms", "values": [1, 2, 3, 4, 5, 6]}},   # 60 simulazioni
    {"sweep": {"path": "seed", "values": [1, 2]}},
    {"sweep": {"path": "aud_latency_ms", "values": [150]}},
    {"sweep": {"path": "aud_latency_ms", "values": [150, 150]}},
    {"sweep": {"path": "../x", "values": [1, 2]}},
    {"sweep": {"path": "builtin", "values": [1, 2]}},            # non è un parametro numerico
    {"sweep": {"path": "n_test", "values": [3, 2.5]}},           # uno dei valori non è lanciabile
    {"sweep": {"path": "n_test", "values": [3, -1]}},
    {"params": {"builtin": "nessuno"}},
])
def test_invalid_campaigns_are_refused_whole(client, auth, network, queued_tasks, body):
    assert create(client, auth, network, **body).status_code == 422
    assert queued_tasks == []
    with SessionLocal() as db:
        assert db.query(Campaign).count() == db.query(Campaign).filter(Campaign.network_id != network["id"]).count()


def test_summary_pools_the_completed_simulations(client, auth, network, files):
    campaign = create(client, auth, network).json()
    ids = [member["id"] for member in campaign["simulations"]]
    assert client.get(f"{API}/{campaign['id']}/summary", headers=auth).json() == {"completed": 0, "reference": None, "points": []}

    for simulation_id in ids[:2]:
        complete(files, simulation_id, entry())
    summary = client.get(f"{API}/{campaign['id']}/summary", headers=auth).json()
    assert summary["completed"] == 2 and len(summary["points"]) == 1
    group = summary["points"][0]["groups"][0]
    assert (group["population"], group["simulations"]) == ("DCN", 2)
    rows = {row["label"]: row for row in group["conditions"]}
    assert list(rows) == ["A", "V", "AV", "race"]
    assert (rows["A"]["trials"], rows["A"]["responses"], rows["race"]["trials"]) == (40, 40, None)
    assert rows["A"]["ci95_ms"][0] <= rows["A"]["median_ms"] <= rows["A"]["ci95_ms"][1]
    assert rows["AV"]["median_ms"] == 245.0 and len(rows["AV"]["percentiles_ms"]) == 10
    assert group["rmi"]["significant"] and group["rmi"]["p_value"] < 0.01
    assert group["percentiles_av_faster_than_race"] == 10
    assert [(s["simulation_id"], s["seed"]) for s in group["per_simulation"]] == [(ids[0], 11), (ids[1], 12)]
    assert "reference" not in rows["A"]

    # Con un set di riferimento ogni condizione che lo ha riporta il confronto.
    updated = client.put(f"{API}/{campaign['id']}", json={"reference": "builtin:cavadini2025-cerebellare"}, headers=auth)
    assert updated.status_code == 200 and updated.json()["reference"] == "builtin:cavadini2025-cerebellare"
    rows = {row["label"]: row for row in client.get(f"{API}/{campaign['id']}/summary", headers=auth).json()["points"][0]["groups"][0]["conditions"]}
    assert rows["A"]["reference"]["responses"] == 541 and rows["A"]["reference"]["median_ms"] == 320.0
    comparison = rows["AV"]["reference"]["comparison"]
    assert comparison["difference_ms"] == 0.0 and not comparison["differs"]
    assert client.put(f"{API}/{campaign['id']}", json={"reference": "builtin:inesistente"}, headers=auth).status_code == 422
    assert client.put(f"{API}/{campaign['id']}", json={"reference": None}, headers=auth).json()["reference"] is None


def test_summary_has_one_point_per_swept_value(client, auth, network, files):
    campaign = create(client, auth, network, seeds=[1, 2], sweep={"path": "aud_latency_ms", "values": [150, 180]}).json()
    for member in campaign["simulations"]:
        complete(files, member["id"], entry(shift=member["value"] - 150))
    points = client.get(f"{API}/{campaign['id']}/summary", headers=auth).json()["points"]
    assert [point["value"] for point in points] == [150, 180]
    medians = [{row["label"]: row["median_ms"] for row in point["groups"][0]["conditions"]}["A"] for point in points]
    assert medians[1] > medians[0] + 15


def test_experiments_without_response_times_have_an_empty_summary(client, auth, network, files):
    continuous = {"phases": {"test_duration_ms": 200}}
    campaign = create(client, auth, network, params=continuous, seeds=[1, 2]).json()
    with SessionLocal() as db:
        for member in campaign["simulations"]:
            simulation = db.get(Simulation, member["id"])
            simulation.status, simulation.results_path = SimulationStatus.COMPLETED, f"results/x/sim_{member['id']}"
        db.commit()
    summary = client.get(f"{API}/{campaign['id']}/summary", headers=auth).json()
    assert summary["completed"] == 2 and summary["points"] == [{"value": None, "groups": []}]


def test_abort_stops_what_is_not_finished_and_delete_removes_everything(client, auth, other_auth, network, files):
    campaign = create(client, auth, network).json()
    ids = [member["id"] for member in campaign["simulations"]]
    path = complete(files, ids[0], entry())

    assert client.get(f"{API}/{campaign['id']}", headers=other_auth).status_code == 404
    assert client.post(f"{API}/{campaign['id']}/abort", headers=other_auth).status_code == 404
    assert client.delete(f"{API}/{campaign['id']}", headers=other_auth).status_code == 404

    assert client.post(f"{API}/{campaign['id']}/abort", headers=auth).json() == {"aborted": 2}
    counts = client.get(f"{API}/{campaign['id']}", headers=auth).json()["counts"]
    assert (counts["COMPLETED"], counts["ABORTED"], counts["PENDING"]) == (1, 2, 0)
    assert client.post(f"{API}/{campaign['id']}/abort", headers=auth).json() == {"aborted": 0}

    assert client.delete(f"{API}/{campaign['id']}", headers=auth).status_code == 204
    assert client.get(f"{API}/{campaign['id']}", headers=auth).status_code == 404
    assert files.list(path) == []
    with SessionLocal() as db:
        assert db.query(Simulation).filter(Simulation.id.in_(ids)).count() == 0


def test_deleting_the_network_deletes_its_campaigns(client, auth, network):
    campaign = create(client, auth, network).json()
    assert client.delete(f"/api/v1/networks/{network['id']}", headers=auth).status_code == 204
    assert client.get(f"{API}/{campaign['id']}", headers=auth).status_code == 404
    with SessionLocal() as db:
        assert db.query(Simulation).filter(Simulation.campaign_id == campaign["id"]).count() == 0


def test_queue_failure_closes_the_simulations_not_queued(client, auth, network, monkeypatch):
    from backend.services import launching

    calls = []

    def flaky_delay(simulation_id):
        calls.append(simulation_id)
        if len(calls) > 1:
            raise ConnectionError("redis non risponde")
        return type("Result", (), {"id": f"task-{simulation_id}"})()

    monkeypatch.setattr(launching.run_simulation_task, "delay", flaky_delay)
    assert create(client, auth, network).status_code == 503
    with SessionLocal() as db:
        statuses = [s.status for s in db.query(Simulation).filter(Simulation.id.in_(range(calls[0], calls[0] + 3))).order_by(Simulation.id)]
    assert statuses == [SimulationStatus.PENDING, SimulationStatus.FAILED, SimulationStatus.FAILED]


def test_expand_and_summarise_are_pure():
    members = expand({"builtin": "decision_making"}, [1, 2], {"path": "network_overrides.eta_ex", "values": [0.9, 0.96]})
    assert [(seed, value) for seed, value, _ in members] == [(1, 0.9), (2, 0.9), (1, 0.96), (2, 0.96)]
    assert members[0][2] == {"builtin": "decision_making", "decision_making": {"seed": 1},
                             "network_overrides": {"eta_ex": 0.9}, "save_spikes": False}
    with pytest.raises(CampaignError):
        expand({"protocol": {"stimuli_pool": []}}, [1], {"path": "protocol.stimuli_pool", "values": [1, 2]})
    with pytest.raises(CampaignError):
        expand({"inputs": []}, [1], {"path": "inputs.rate", "values": [1, 2]})

    # Senza risposte in una condizione la disuguaglianza non si calcola e gli intervalli mancano.
    empty = summarise_group([(1, 1, {"population": "GR", "trials": {"V": 4, "A": 4, "AV": 4},
                                     "reaction_times_ms": {"V": [300.0], "A": [], "AV": [250.0, 260.0]}})])
    rows = {row["label"]: row for row in empty["conditions"]}
    assert empty["rmi"] is None and list(rows) == ["A", "V", "AV"]
    assert (rows["A"]["median_ms"], rows["A"]["ci95_ms"], rows["V"]["ci95_ms"]) == (None, None, None)
    assert rows["AV"]["ci95_ms"] == [250.0, 260.0]
    # Popolazioni diverse della stessa simulazione restano gruppi separati.
    two = summarise([(1, 1, None, [{"population": "GR", "reaction_times_ms": {}}, {"population": "PC", "reaction_times_ms": {}}])])
    assert [group["population"] for group in two[0]["groups"]] == ["GR", "PC"]
