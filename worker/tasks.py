import importlib
import logging
import time

from celery import Task
from celery.signals import worker_ready
from sqlalchemy import select

from backend.core.db import SessionLocal
from backend.models import Network, Simulation, SimulationStatus, Stimulus
from backend.services.experiments import experiment_kind
from backend.services.storage import storage
from worker.celery_app import celery_app

logger = logging.getLogger(__name__)

ABORT_CHECK_INTERVAL_S = 2.0

# Ogni esperimento espone run(sim_info, exp_params, storage, progress_cb).
EXPERIMENTS = {
    "decision_making": ("worker.networks.decision_making", "run_decision_making_experiment"),
    "cerebellum_conditioning": ("worker.networks.cerebellum_conditioning", "run_cerebellum_conditioning"),
    "cerebellum_msi_race": ("worker.networks.cerebellum_msi_race", "run_cerebellum_msi_race"),
    "trial_protocol": ("worker.networks.generic", "run_generic_experiment"),
    "continuous": ("worker.networks.generic", "run_generic_experiment"),
}


class SimulationAborted(Exception):
    """La simulazione è stata interrotta (o eliminata) mentre il worker la eseguiva."""


def _is_aborted(simulation_id: int) -> bool:
    # Sessione dedicata: quella del task è dentro una transazione REPEATABLE READ
    # e non vedrebbe lo stato scritto dall'API.
    with SessionLocal() as session:
        status = session.scalar(select(Simulation.status).where(Simulation.id == simulation_id))
    return status is None or status == SimulationStatus.ABORTED


@worker_ready.connect
def fail_interrupted_simulations(**_kwargs) -> None:
    """Il worker esegue una simulazione alla volta: se all'avvio ne trova una RUNNING,
    è rimasta a metà per un riavvio o un crash e nessuno la sta più calcolando."""
    with SessionLocal() as db:
        interrupted = db.query(Simulation).filter(Simulation.status == SimulationStatus.RUNNING).all()
        for simulation in interrupted:
            simulation.status = SimulationStatus.FAILED
            simulation.error_message = "Il simulatore è stato riavviato mentre la simulazione era in corso."
            storage.delete_tree(f"results/{simulation.owner_id}/sim_{simulation.id}")
            logger.warning("Simulazione %s chiusa come fallita: era in corso al riavvio.", simulation.id)
        db.commit()


@celery_app.task(bind=True, name="worker.tasks.run_simulation_task")
def run_simulation_task(self: Task, simulation_id: int) -> dict:
    with SessionLocal() as db:
        simulation = db.get(Simulation, simulation_id)
        # Si esegue solo ciò che è in coda. Un task riconsegnato da Celery dopo la morte
        # del worker trova la simulazione già chiusa (vedi fail_interrupted_simulations).
        if not simulation or simulation.status != SimulationStatus.PENDING:
            return {"status": simulation.status.value if simulation else "ABORTED"}

        owner_id = simulation.owner_id
        exp_params = simulation.experiment_params or {}
        network_definition = simulation.network_definition or db.get(Network, simulation.network_id).definition
        base_path = f"results/{owner_id}/sim_{simulation_id}"

        simulation.status = SimulationStatus.RUNNING
        db.commit()

        last_abort_check = time.monotonic()

        def progress(percent: float, phase: str) -> None:
            # Il pool "solo" di Celery non può revocare un task in corso: l'interruzione
            # è cooperativa, il worker rilegge lo stato a ogni avanzamento.
            nonlocal last_abort_check
            now = time.monotonic()
            if now - last_abort_check >= ABORT_CHECK_INTERVAL_S:
                last_abort_check = now
                if _is_aborted(simulation_id):
                    raise SimulationAborted()
            self.update_state(state="PROGRESS", meta={"current": int(percent), "total": 100, "phase": phase})

        def load_stimulus(stimulus_id) -> list:
            stimulus = db.query(Stimulus).filter(Stimulus.id == stimulus_id, Stimulus.owner_id == owner_id).first()
            if not stimulus or not stimulus.file_path:
                raise ValueError(f"Stimolo {stimulus_id} non trovato")
            return storage.read_json(stimulus.file_path)["spike_trains"]

        sim_info = {
            "owner_id": owner_id,
            "sim_id": simulation_id,
            "network_definition": network_definition,
            "load_stimulus": load_stimulus,
        }

        try:
            module_name, function_name = EXPERIMENTS[experiment_kind(exp_params)]
            run_experiment = getattr(importlib.import_module(module_name), function_name)
            run_experiment(sim_info, exp_params, storage, progress)
            if _is_aborted(simulation_id):
                raise SimulationAborted()
        except SimulationAborted:
            storage.delete_tree(base_path)
            logger.info("Simulazione %s interrotta.", simulation_id)
            return {"status": "ABORTED"}
        except Exception as exc:
            logger.exception("Simulazione %s fallita", simulation_id)
            db.rollback()
            storage.delete_tree(base_path)
            if not _is_aborted(simulation_id):
                simulation.status = SimulationStatus.FAILED
                simulation.error_message = f"{type(exc).__name__}: {exc}"[:2000]
                db.commit()
            return {"status": "FAILED"}

        simulation.results_path = base_path
        simulation.status = SimulationStatus.COMPLETED
        db.commit()
        logger.info("Simulazione %s completata.", simulation_id)
        return {"status": "COMPLETED"}
