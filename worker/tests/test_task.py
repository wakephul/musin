import shutil

import pytest

from backend.core.db import SessionLocal
from backend.core.migrations import upgrade_database
from backend.core.security import get_password_hash
from backend.models import Network, Simulation, SimulationStatus, User
from backend.services.storage import storage
from worker import tasks
from worker.results import ResultStore


@pytest.fixture
def files(monkeypatch):
    """Lo storage vero su cartella temporanea; il task non parla con Redis."""
    shutil.rmtree(storage.root, ignore_errors=True)
    monkeypatch.setattr(tasks.run_simulation_task, "update_state", lambda **kwargs: None)
    monkeypatch.setattr(tasks, "ABORT_CHECK_INTERVAL_S", 0.0)
    return storage


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


def test_completed_simulation_stores_the_results_path(monkeypatch, files, simulation_id):
    def writes_results(task, sim_info, exp_params, storage, progress):
        progress(50, "metà")
        store = ResultStore(storage, f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}")
        store.put_json("spikes.json", {"spikes": {}})
        store.close()

    use_experiment(monkeypatch, writes_results)
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "COMPLETED"}
    status, results_path, error = read(simulation_id)
    assert status == SimulationStatus.COMPLETED and error is None
    assert files.list(results_path) == [f"{results_path}/graphs.zip", f"{results_path}/spikes.json"]


def test_failure_is_recorded_with_its_reason_and_partial_results_are_removed(monkeypatch, files, simulation_id):
    def fails(task, sim_info, exp_params, storage, progress):
        storage.write(f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}/partial.png", b"x")
        raise ValueError("popolazione inesistente: XYZ")

    use_experiment(monkeypatch, fails)
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "FAILED"}
    status, results_path, error = read(simulation_id)
    assert status == SimulationStatus.FAILED and results_path is None
    assert error == "ValueError: popolazione inesistente: XYZ"
    assert files.list("results") == []


def test_abort_during_the_run_stops_at_the_next_progress_update(monkeypatch, files, simulation_id):
    steps = []

    def aborted_midway(task, sim_info, exp_params, storage, progress):
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


def test_a_simulation_aborted_while_queued_never_runs(monkeypatch, files, simulation_id):
    def must_not_run(task, sim_info, exp_params, storage, progress):
        raise AssertionError("l'esperimento non doveva partire")

    use_experiment(monkeypatch, must_not_run)
    with SessionLocal() as db:
        db.get(Simulation, simulation_id).status = SimulationStatus.ABORTED
        db.commit()
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "ABORTED"}
    assert tasks.run_simulation_task.run(999_999) == {"status": "ABORTED"}   # simulazione eliminata
