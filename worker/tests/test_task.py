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
    def writes_results(sim_info, exp_params, storage, progress):
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
    def fails(sim_info, exp_params, storage, progress):
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

    def aborted_midway(sim_info, exp_params, storage, progress):
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
    def must_not_run(sim_info, exp_params, storage, progress):
        raise AssertionError("l'esperimento non doveva partire")

    use_experiment(monkeypatch, must_not_run)
    with SessionLocal() as db:
        db.get(Simulation, simulation_id).status = SimulationStatus.ABORTED
        db.commit()
    assert tasks.run_simulation_task.run(simulation_id) == {"status": "ABORTED"}
    assert tasks.run_simulation_task.run(999_999) == {"status": "ABORTED"}   # simulazione eliminata


def test_a_redelivered_task_does_not_rerun_a_closed_simulation(monkeypatch, files, simulation_id):
    def must_not_run(sim_info, exp_params, storage, progress):
        raise AssertionError("l'esperimento non doveva partire")

    use_experiment(monkeypatch, must_not_run)
    for status in (SimulationStatus.COMPLETED, SimulationStatus.FAILED, SimulationStatus.RUNNING):
        with SessionLocal() as db:
            db.get(Simulation, simulation_id).status = status
            db.commit()
        assert tasks.run_simulation_task.run(simulation_id) == {"status": status.value}


def test_simulations_left_running_by_a_restart_are_closed_as_failed(files, simulation_id):
    with SessionLocal() as db:
        simulation = db.get(Simulation, simulation_id)
        simulation.status = SimulationStatus.RUNNING
        db.commit()
        partial = f"results/{simulation.owner_id}/sim_{simulation_id}/partial.png"
    files.write(partial, b"x")
    tasks.fail_interrupted_simulations()
    status, _, error = read(simulation_id)
    assert status == SimulationStatus.FAILED and "riavviato" in error
    assert files.list("results") == []


def test_the_experiment_receives_the_network_saved_at_launch(monkeypatch, files, simulation_id):
    seen = {}

    def records_network(sim_info, exp_params, storage, progress):
        seen.update(sim_info["network_definition"])

    use_experiment(monkeypatch, records_network)
    with SessionLocal() as db:
        db.get(Simulation, simulation_id).network_definition = {"topology": {"populations": [{"id": "AL_LANCIO"}], "projections": []}}
        db.commit()
    tasks.run_simulation_task.run(simulation_id)
    assert seen["topology"]["populations"][0]["id"] == "AL_LANCIO"


def test_result_names_cannot_leave_the_simulation_folder(files):
    store = ResultStore(files, "results/1/sim_1")
    for name in ("../../2/sim_5/GR_raster.png", "a/b.png", ".nascosto", "..\\x.png"):
        with pytest.raises(ValueError):
            store.put(name, b"x")
    assert files.list("results") == []


def test_campaign_simulations_do_not_save_their_spikes(monkeypatch, files, simulation_id):
    def writes_results(sim_info, exp_params, storage, progress):
        store = ResultStore(storage, f"results/{sim_info['owner_id']}/sim_{sim_info['sim_id']}", sim_info["skip_files"])
        store.put_json("spikes.json", {"spikes": {}}, in_zip=False)
        store.put_json("race_model.json", {"race_model": []})
        store.close()

    use_experiment(monkeypatch, writes_results)
    with SessionLocal() as db:
        simulation = db.get(Simulation, simulation_id)
        simulation.experiment_params = {**simulation.experiment_params, "save_spikes": False}
        db.commit()
    tasks.run_simulation_task.run(simulation_id)
    assert sorted(name.rsplit("/", 1)[-1] for name in files.list("results")) == ["graphs.zip", "race_model.json"]


def test_result_folders_without_a_simulation_are_removed_at_start(files, simulation_id):
    with SessionLocal() as db:
        owner = db.get(Simulation, simulation_id).owner_id
    files.write(f"results/{owner}/sim_{simulation_id}/kept.png", b"x")
    files.write(f"results/{owner}/sim_999999/orphan.png", b"x")       # simulazione eliminata
    files.write(f"results/{owner + 1}/sim_{simulation_id}/orphan.png", b"x")  # stesso id, altro utente
    files.write(f"results/{owner}/graphs.zip", b"x")                   # non è una cartella di simulazione
    tasks.remove_orphan_results()
    assert sorted(files.list("results")) == [f"results/{owner}/graphs.zip", f"results/{owner}/sim_{simulation_id}/kept.png"]
