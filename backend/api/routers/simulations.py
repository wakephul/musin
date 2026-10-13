import json
import logging
from typing import Optional

from celery.result import AsyncResult
from fastapi import APIRouter, Form, HTTPException, Query, status
from sqlalchemy import func

from backend.api.deps import CurrentUser, SessionDep
from backend.core.config import settings
from backend.core.nest_models import SPIKE_TRAIN_STIMULUS
from backend.models import Network, Simulation, SimulationStatus, Stimulus
from backend.schemas import SimulationPage, SimulationResponse
from backend.services.experiments import estimate_duration_ms, experiment_kind
from backend.services.minio_client import minio_service
from worker.celery_app import celery_app
from worker.tasks import run_simulation_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/simulations", tags=["Simulations"])

FINAL_STATUSES = (SimulationStatus.COMPLETED, SimulationStatus.FAILED, SimulationStatus.ABORTED)
RESULT_JSON_FILES = {
    "accuracy_metrics": "accuracy_metrics.json",
    "race_model_data": "race_model.json",
    "experiment_metrics": "experiment_metrics.json",
    "response_analysis": "response_times.json",
}


def _get_owned_simulation(db, simulation_id: int, user_id: int) -> Simulation:
    simulation = db.query(Simulation).filter(Simulation.id == simulation_id, Simulation.owner_id == user_id).first()
    if not simulation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Simulazione non trovata")
    return simulation


def _to_response(simulation: Simulation) -> SimulationResponse:
    params = simulation.experiment_params or {}
    return SimulationResponse(
        id=simulation.id,
        name=simulation.name,
        network_id=simulation.network_id,
        network_name=simulation.network.name if simulation.network else None,
        owner_id=simulation.owner_id,
        status=simulation.status,
        experiment=experiment_kind(params),
        duration_ms=simulation.duration_ms,
        experiment_params=params,
        error_message=simulation.error_message,
        created_at=simulation.created_at,
        updated_at=simulation.updated_at,
    )


@router.get("", response_model=SimulationPage)
def read_simulations(
    db: SessionDep,
    current_user: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status_filter: Optional[SimulationStatus] = Query(None, alias="status"),
    network_id: Optional[int] = None,
) -> SimulationPage:
    owned = db.query(Simulation).filter(Simulation.owner_id == current_user.id)
    counts = dict.fromkeys((s.value for s in SimulationStatus), 0)
    for sim_status, count in owned.with_entities(Simulation.status, func.count()).group_by(Simulation.status):
        counts[sim_status.value] = count

    filtered = owned
    if status_filter:
        filtered = filtered.filter(Simulation.status == status_filter)
    if network_id is not None:
        filtered = filtered.filter(Simulation.network_id == network_id)
    items = filtered.order_by(Simulation.id.desc()).offset(skip).limit(limit).all()
    return SimulationPage(items=[_to_response(s) for s in items], total=filtered.count(), counts=counts)


def _check_stimulus_devices(db, params: dict, user_id: int) -> None:
    """I device 'treni da file' devono puntare a uno stimolo dell'utente."""
    inputs = params.get("inputs") or {}
    for device in inputs.get("devices", []) if isinstance(inputs, dict) else []:
        if device.get("model") != SPIKE_TRAIN_STIMULUS:
            continue
        stimulus_id = (device.get("params") or {}).get("stimulus_id")
        owned = isinstance(stimulus_id, int) and db.query(Stimulus).filter(
            Stimulus.id == stimulus_id, Stimulus.owner_id == user_id
        ).first()
        if not owned:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Il device '{device.get('id')}' non ha uno stimolo valido selezionato",
            )


@router.post("/launch", status_code=status.HTTP_201_CREATED)
def launch_simulation(
    db: SessionDep,
    current_user: CurrentUser,
    network_id: int = Form(...),
    params: str = Form("{}"),
    name: Optional[str] = Form(None, max_length=255),
) -> dict:
    network = db.query(Network).filter(Network.id == network_id, Network.owner_id == current_user.id).first()
    if not network:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rete non trovata")

    try:
        parsed_params = json.loads(params)
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"I parametri non sono JSON valido: {exc}") from exc
    if not isinstance(parsed_params, dict):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "I parametri devono essere un oggetto JSON")

    try:
        total_duration_ms = estimate_duration_ms(parsed_params)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    if total_duration_ms <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "La durata totale della simulazione deve essere maggiore di 0")
    if total_duration_ms > settings.MAX_SIMULATION_MS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"La simulazione durerebbe {total_duration_ms / 1000:.0f} s di tempo biologico: "
            f"il massimo è {settings.MAX_SIMULATION_MS / 1000:.0f} s",
        )
    _check_stimulus_devices(db, parsed_params, current_user.id)

    simulation = Simulation(
        name=name or network.name,
        network_id=network.id,
        duration_ms=total_duration_ms,
        experiment_params=parsed_params,
        owner_id=current_user.id,
        status=SimulationStatus.PENDING,
    )
    db.add(simulation)
    db.commit()
    db.refresh(simulation)

    try:
        task = run_simulation_task.delay(simulation.id)
    except Exception as exc:
        logger.error("Accodamento della simulazione %s fallito: %s", simulation.id, exc)
        simulation.status = SimulationStatus.FAILED
        simulation.error_message = "Coda di simulazione non raggiungibile"
        db.commit()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Coda di simulazione non raggiungibile") from exc

    simulation.celery_task_id = task.id
    db.commit()
    return {"simulation_id": simulation.id}


@router.get("/{simulation_id}", response_model=SimulationResponse)
def get_simulation(db: SessionDep, current_user: CurrentUser, simulation_id: int) -> SimulationResponse:
    return _to_response(_get_owned_simulation(db, simulation_id, current_user.id))


@router.get("/{simulation_id}/status")
def get_simulation_status(db: SessionDep, current_user: CurrentUser, simulation_id: int) -> dict:
    simulation = _get_owned_simulation(db, simulation_id, current_user.id)
    progress, phase = 0, None
    if simulation.status == SimulationStatus.COMPLETED:
        progress = 100
    elif simulation.status == SimulationStatus.RUNNING and simulation.celery_task_id:
        task_result = AsyncResult(simulation.celery_task_id, app=celery_app)
        if task_result.state == "PROGRESS" and isinstance(task_result.info, dict):
            progress = task_result.info.get("current", 0)
            phase = task_result.info.get("phase")

    return {
        "status": simulation.status.value,
        "progress": progress,
        "phase": phase,
        "error_message": simulation.error_message,
        "network_id": simulation.network_id,
        "experiment_params": simulation.experiment_params,
    }


@router.post("/{simulation_id}/abort")
def abort_simulation(db: SessionDep, current_user: CurrentUser, simulation_id: int) -> dict:
    simulation = _get_owned_simulation(db, simulation_id, current_user.id)
    if simulation.status in FINAL_STATUSES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Impossibile interrompere: la simulazione è già in stato {simulation.status.value}",
        )
    # Il worker rilegge lo stato a ogni avanzamento e si ferma da solo
    # (vedi worker.tasks._is_aborted): niente revoke, che con il pool "solo" non ha effetto.
    simulation.status = SimulationStatus.ABORTED
    db.commit()
    return {"message": "Simulazione interrotta", "status": "ABORTED"}


@router.get("/{simulation_id}/results")
def get_simulation_results(db: SessionDep, current_user: CurrentUser, simulation_id: int) -> dict:
    simulation = _get_owned_simulation(db, simulation_id, current_user.id)
    if simulation.status != SimulationStatus.COMPLETED or not simulation.results_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Risultati non disponibili")

    base_path = simulation.results_path
    files = {name.split("/")[-1] for name in minio_service.list_objects_with_prefix(base_path)}

    def url(filename: str) -> Optional[str]:
        return minio_service.get_presigned_url(f"{base_path}/{filename}") if filename in files else None

    def stem(filename: str, prefix: str) -> Optional[str]:
        if filename.startswith(prefix) and filename.endswith(".png"):
            return filename[len(prefix):-len(".png")]
        return None

    # Raster e PSTH: si mostra ciò che il worker ha effettivamente prodotto, nell'ordine
    # delle popolazioni della rete (gli esperimenti built-in possono usare altri nomi).
    network_order = [p["id"] for p in simulation.network.definition.get("topology", {}).get("populations", [])]
    recorded = sorted(
        (name[:-len("_raster.png")] for name in files if name.endswith("_raster.png")),
        key=lambda pop: (network_order.index(pop) if pop in network_order else len(network_order), pop),
    )
    population_graphs = [
        {"population_id": pop, "raster_url": url(f"{pop}_raster.png"), "histogram_url": url(f"{pop}_histogram.png")}
        for pop in recorded
    ]

    differential_graphs, race_model_graphs, experiment_graphs, response_graphs = [], [], [], []
    for filename in sorted(files):
        if (name := stem(filename, "diff_")) is not None:
            # diff_<pop_a>__<pop_b>.png; i file più vecchi usano un solo underscore e non sono separabili.
            differential_graphs.append({"label": name.replace("__", " − "), "url": url(filename)})
        elif (name := stem(filename, "rmi_")) is not None:
            race_model_graphs.append({"population": name, "url": url(filename)})
        elif (name := stem(filename, "exp_")) is not None:
            experiment_graphs.append({"label": name.replace("_", " "), "url": url(filename)})
        elif (name := stem(filename, "activation_")) is not None:
            response_graphs.append({"kind": "activation", "pair": name, "url": url(filename)})
        elif (name := stem(filename, "cdf_")) is not None:
            response_graphs.append({"kind": "cdf", "pair": name, "url": url(filename)})

    json_results = {
        key: (minio_service.get_json_object(f"{base_path}/{filename}") if filename in files else None)
        for key, filename in RESULT_JSON_FILES.items()
    }

    return {
        **_to_response(simulation).model_dump(mode="json"),
        "raw_file_url": url("spikes.json"),
        "graphs_zip_url": url("graphs.zip"),
        "population_graphs": population_graphs,
        "differential_graphs": differential_graphs,
        "race_model_graphs": race_model_graphs,
        "experiment_graphs": experiment_graphs,
        "response_graphs": response_graphs,
        **json_results,
    }


@router.delete("/{simulation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_simulation(db: SessionDep, current_user: CurrentUser, simulation_id: int) -> None:
    """Elimina la simulazione. Se è in corso, il worker si ferma al controllo successivo."""
    simulation = _get_owned_simulation(db, simulation_id, current_user.id)
    if simulation.results_path:
        minio_service.delete_directory(simulation.results_path)
    db.delete(simulation)
    db.commit()
