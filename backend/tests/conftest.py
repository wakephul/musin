import itertools

import pytest
from fastapi.testclient import TestClient

from backend.api.routers import networks, simulations, stimuli
from backend.main import app


class FakeMinio:
    """MinIO in memoria con la stessa interfaccia di MinioService."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def upload_file(self, stream, size, object_name, content_type="application/octet-stream"):
        self.objects[object_name] = stream.read()
        return object_name

    def upload_json(self, object_name, obj):
        import json
        self.objects[object_name] = json.dumps(obj).encode()
        return object_name

    def get_json_object(self, object_name):
        import json
        return json.loads(self.objects[object_name])

    def get_presigned_url(self, object_name, expires=None):
        return f"http://minio.test/{object_name}"

    def list_objects_with_prefix(self, prefix):
        prefix = prefix.rstrip("/") + "/"
        return [name for name in self.objects if name.startswith(prefix)]

    def delete_object(self, object_name):
        self.objects.pop(object_name, None)

    def delete_directory(self, prefix):
        for name in self.list_objects_with_prefix(prefix):
            del self.objects[name]


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:  # il lifespan applica le migrazioni e crea l'utente iniziale
        yield test_client


@pytest.fixture(autouse=True)
def minio(monkeypatch):
    fake = FakeMinio()
    for module in (networks, simulations, stimuli):
        monkeypatch.setattr(module, "minio_service", fake)
    return fake


@pytest.fixture(autouse=True)
def queued_tasks(monkeypatch):
    """Sostituisce l'accodamento su Celery: restituisce gli id di simulazione accodati."""
    queued = []
    task_ids = itertools.count(1)

    class FakeAsyncResult:
        def __init__(self):
            self.id = f"task-{next(task_ids)}-{id(self)}"

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
