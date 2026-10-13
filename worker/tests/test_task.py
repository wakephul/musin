import pytest

from backend.core.db import SessionLocal
from backend.core.migrations import upgrade_database
from backend.core.security import get_password_hash
from backend.models import Network, Simulation, SimulationStatus, User
from worker import tasks
from worker.results import ResultStore


class FakeMinio:
    def __init__(self):
        self.objects = {}

    def upload_file(self, stream, size, object_name, content_type="application/octet-stream"):
        self.objects[object_name] = stream.read()

    def delete_directory(self, prefix):
        for name in [name for name in self.objects if name.startswith(prefix.rstrip("/") + "/")]:
            del self.objects[name]


@pytest.fixture
def minio(monkeypatch):
    fake = FakeMinio()
    monkeypatch.setattr(tasks, "minio_service", fake)
    monkeypatch.setattr(tasks.run_simulation_task, "update_state", lambda **kwargs: None)
    monkeypatch.setattr(tasks, "ABORT_CHECK_INTERVAL_S", 0.0)
    return fake


@pytest.fixture
def simulation_id():
    upgrade_database()
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "worker@example.com").first()
        if not user:
            user = User(email="worker@example.com", hashed_password=get_password_hash("password-123"), is_active=True)
            db.add(user)
            db.flush()
        network = Network(name="n", definition={"topology": {"populations": [], "projections": []}}, owner_id=user.id)
        db.add(network)
        db.flush()
        simulation = Simulation(name="s", network_id=network.id, owner_id=user.id, duration_ms=100.0,
                                experiment_params={"phases": {"test_duration_ms": 100}}, status=SimulationStatus.PENDING)
        db.add(simulation)
        db.commit()
        return simulation.id


def use_experiment(monkeypatch, function):
    monkeypatch.setitem(tasks.EXPERIMENTS, "continuous", (__name__, function.__name__))
    globals()[function.__name__] = function


def read(simulation_id):
    with SessionLocal() as db:
        simulation = db.get(Simulation, simulation_id)
        return simulation.status, simulation.results_path, simulation.error_message


def test_completed_simulation_stores_the_results_path(monkeypatch, minio, simulation_id):
    def writes_results(task, sim_info, exp_params, minio_service, progress):
        progress(50, "metà")
        store = ResultStore(minio_service, f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}")
        store.put_json("spikes.json", {"spikes": {}})
        store.close()

    use_experiment(monkeypatch, writes_results)
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "COMPLETED"}
    status, results_path, error = read(simulation_id)
    assert status == SimulationStatus.COMPLETED and error is None
    assert sorted(name.removeprefix(results_path + "/") for name in minio.objects) == ["graphs.zip", "spikes.json"]


def test_failure_is_recorded_with_its_reason_and_partial_results_are_removed(monkeypatch, minio, simulation_id):
    def fails(task, sim_info, exp_params, minio_service, progress):
        minio_service.upload_file(__import__("io").BytesIO(b"x"), 1, f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}/partial.png")
        raise ValueError("popolazione inesistente: XYZ")

    use_experiment(monkeypatch, fails)
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "FAILED"}
    status, results_path, error = read(simulation_id)
    assert status == SimulationStatus.FAILED and results_path is None
    assert error == "ValueError: popolazione inesistente: XYZ"
    assert minio.objects == {}


def test_abort_during_the_run_stops_at_the_next_progress_update(monkeypatch, minio, simulation_id):
    steps = []

    def aborted_midway(task, sim_info, exp_params, minio_service, progress):
        progress(10, "primo passo")
        steps.append("first")
        with SessionLocal() as db:
            db.get(Simulation, sim_info["sim_id"]).status = SimulationStatus.ABORTED
            db.commit()
        progress(20, "secondo passo")
        steps.append("never reached")

    use_experiment(monkeypatch, aborted_midway)
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "ABORTED"}
    assert steps == ["first"]
    assert read(simulation_id)[0] == SimulationStatus.ABORTED


def test_a_simulation_aborted_while_queued_never_runs(monkeypatch, minio, simulation_id):
    def must_not_run(task, sim_info, exp_params, minio_service, progress):
        raise AssertionError("l'esperimento non doveva partire")

    use_experiment(monkeypatch, must_not_run)
    with SessionLocal() as db:
        db.get(Simulation, simulation_id).status = SimulationStatus.ABORTED
        db.commit()
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "ABORTED"}
    assert tasks.run_simulation_task.run(999_999) == {"status": "ABORTED"}   # simulazione eliminata
