"""Controlli e accodamento di una simulazione, comuni al lancio singolo e alle campagne."""
import logging
import math

from fastapi import HTTPException, status

from backend.core.config import settings
from backend.core.nest_models import SPIKE_TRAIN_STIMULUS
from backend.models import Simulation, SimulationStatus, Stimulus
from backend.services.experiments import estimate_duration_ms
from worker.tasks import run_simulation_task

logger = logging.getLogger(__name__)

QUEUE_UNREACHABLE = "Coda di simulazione non raggiungibile"


def reject_non_finite(value) -> None:
    """NaN e Infinity non sono JSON e MySQL non li salva."""
    if isinstance(value, float) and not math.isfinite(value):
        raise HTTPException(422, "I parametri contengono un valore non finito")
    for item in value.values() if isinstance(value, dict) else value if isinstance(value, list) else ():
        reject_non_finite(item)


def _check_stimulus_devices(db, params: dict, user_id: int) -> None:
    """I device 'treni da file' devono puntare a uno stimolo dell'utente."""
    inputs = params.get("inputs") or {}
    for device in inputs.get("devices", []) if isinstance(inputs, dict) else []:
        if device.get("model") != SPIKE_TRAIN_STIMULUS:
            continue
        stimulus_id = (device.get("params") or {}).get("stimulus_id")
        stimulus = isinstance(stimulus_id, int) and db.query(Stimulus).filter(
            Stimulus.id == stimulus_id, Stimulus.owner_id == user_id
        ).first()
        if not stimulus:
            raise HTTPException(
                422,
                f"Il device '{device.get('id')}' non ha uno stimolo valido selezionato",
            )
        # Gli stimoli caricati prima della libreria sono file grezzi che il worker non sa leggere.
        if not (stimulus.definition or {}).get("n_trains"):
            raise HTTPException(
                422,
                f"Lo stimolo '{stimulus.name}' è stato caricato con una versione precedente: caricalo di nuovo dalla pagina Stimoli",
            )


def checked_duration_ms(db, params: dict, user_id: int) -> float:
    """Durata biologica della simulazione, dopo aver verificato che i parametri siano lanciabili."""
    try:
        total_duration_ms = estimate_duration_ms(params)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if total_duration_ms <= 0:
        raise HTTPException(422, "La durata totale della simulazione deve essere maggiore di 0")
    if total_duration_ms > settings.MAX_SIMULATION_MS:
        raise HTTPException(
            422,
            f"La simulazione durerebbe {total_duration_ms / 1000:.0f} s di tempo biologico: "
            f"il massimo è {settings.MAX_SIMULATION_MS / 1000:.0f} s",
        )
    _check_stimulus_devices(db, params, user_id)
    return total_duration_ms


def enqueue(db, simulations: list[Simulation]) -> None:
    """Accoda le simulazioni già salvate. Se la coda non risponde, quelle non accodate
    vengono chiuse come fallite e la richiesta termina con 503."""
    for index, simulation in enumerate(simulations):
        try:
            simulation.celery_task_id = run_simulation_task.delay(simulation.id).id
        except Exception as exc:
            logger.error("Accodamento della simulazione %s fallito: %s", simulation.id, exc)
            for missed in simulations[index:]:
                missed.status = SimulationStatus.FAILED
                missed.error_message = QUEUE_UNREACHABLE
            db.commit()
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, QUEUE_UNREACHABLE) from exc
    db.commit()
