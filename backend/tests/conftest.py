import itertools
import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api.routers import simulations
from backend.main import app
from backend.services.storage import storage


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:  # il lifespan applica le migrazioni e crea l'utente iniziale
        yield test_client


@pytest.fixture(autouse=True)
def files():
    """Lo storage vero, su cartella temporanea, svuotato a ogni test."""
    shutil.rmtree(storage.root, ignore_errors=True)
    return storage


@pytest.fixture(autouse=True)
def queued_tasks(monkeypatch):
    """Sostituisce l'accodamento su Celery: restituisce gli id di simulazione accodati."""
    queued = []

    class FakeAsyncResult:
        def __init__(self):
            self.id = uuid.uuid4().hex   # celery_task_id è unico nel database

    def fake_delay(simulation_id):
        queued.append(simulation_id)
        return FakeAsyncResult()

    monkeypatch.setattr(simulations.run_simulation_task, "delay", fake_delay)
    return queued


_emails = (f"user{n}@example.com" for n in itertools.count(1))


@pytest.fixture
def auth(client):
    """Header di autenticazione di un utente nuovo a ogni test."""
    response = client.post("/api/v1/auth/register", json={"email": next(_emails), "password": "password-123"})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def other_auth(client):
    response = client.post("/api/v1/auth/register", json={"email": next(_emails), "password": "password-123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


NETWORK = {
    "name": "Rete di prova",
    "description": "due popolazioni",
    "nodes_count": 30,
    "edges_count": 200,
    "params": {},
    "topology": {
        "populations": [
            {"id": "GR", "size": 20, "neuron_model": "iaf_cond_exp", "params": {"C_m": 2.0}},
            {"id": "PC_A", "size": 10, "neuron_model": "iaf_cond_exp", "params": {}},
        ],
        "projections": [
            {"source": "GR", "target": "PC_A", "rule": "fixed_indegree", "synapse_model": "static_synapse",
             "params": {"indegree": 16, "weight": 4.0, "delay": 1.0}},
        ],
    },
}


@pytest.fixture
def network(client, auth):
    response = client.post("/api/v1/networks", json=NETWORK, headers=auth)
    assert response.status_code == 201, response.text
    return response.json()
