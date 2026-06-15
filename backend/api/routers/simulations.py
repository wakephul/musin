import uuid
import json
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, status, Form, File, UploadFile
from celery.result import AsyncResult
from backend.api.deps import SessionDep, CurrentUser
from backend.models import Simulation, SimulationStatus, Network, Stimulus
from backend.schemas import SimulationResponse
from backend.services.minio_client import minio_service
from worker.celery_app import celery_app
from worker.tasks import run_simulation_task

router = APIRouter(prefix="/simulations", tags=["Simulations"])

@router.get("", response_model=List[SimulationResponse])
def read_simulations(db: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100) -> Any:
    simulations = db.query(Simulation).filter(Simulation.owner_id == current_user.id).offset(skip).limit(limit).all()
    return simulations

@router.post("/launch", status_code=status.HTTP_201_CREATED)
def launch_simulation(
    *, 
    db: SessionDep, 
    current_user: CurrentUser, 
    network_id: str = Form(...),
    params: str = Form("{}"), 
    stimuli: Optional[UploadFile] = File(None)
) -> dict:
    network = db.query(Network).filter(Network.id == int(network_id), Network.owner_id == current_user.id).first()
    if not network:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Network not found or not owned")
    
    try:
        parsed_params = json.loads(params)
    except Exception:
        parsed_params = {}

    # Calcolo dinamico della durata totale basato sul protocollo a Trial
    protocol = parsed_params.get("protocol", {})

    # Built-in experiments (e.g. Wang audiovisual decision network) compute
    # their own duration from the experiment config rather than protocol/phases.
    builtin = parsed_params.get("builtin")
    if builtin == "decision_making":
        dm = parsed_params.get("decision_making", {}) or {}
        trial_slot = float(dm.get("trial_slot_ms", 1000.0))
        num_trials = int(dm.get("num_trials", 12))
        total_duration_ms = trial_slot * num_trials
    elif builtin == "cerebellum_conditioning":
        n_train = int(parsed_params.get("n_train", 20))
        n_test  = int(parsed_params.get("n_test",  20))
        total_duration_ms = (n_train + n_test * 3) * 3000.0
    elif builtin == "cerebellum_msi_race":
        # The module recomputes the exact timeline (random ITI) internally;
        # this is only an upper-bound estimate so total_duration_ms > 0.
        tr = parsed_params.get("train", {}) or {}
        te = parsed_params.get("test", {}) or {}
        tr_iti = (tr.get("iti_range_ms") or [500, 1000])
        te_iti = (te.get("iti_range_ms") or [1000, 2500])
        total_duration_ms = (
            int(tr.get("n_trials", 50)) * (float(tr.get("trial_duration_ms", 1000.0)) + float(tr_iti[1])) +
            int(te.get("n_trials", 100)) * (float(te.get("trial_duration_ms", 1500.0)) + float(te_iti[1]))
        )
    # Se esiste il protocollo trial-based, calcola il tempo su quello
    elif protocol:
        num_trials = int(protocol.get("num_trials", 1))
        trial_duration = float(protocol.get("trial_duration_ms", 1000.0))
        iti_ms = float(protocol.get("iti_ms", 0.0))
        # Durata totale = (durata trial + ITI) per ogni trial
        total_duration_ms = num_trials * (trial_duration + iti_ms)
    else:
        # Fallback alla vecchia logica (train + test semplice) se protocol non c'è
        phases = parsed_params.get("phases", {})
        train_ms = float(phases.get("train_duration_ms", 0.0))
        test_ms = float(phases.get("test_duration_ms", 0.0))
        total_duration_ms = train_ms + test_ms

    if total_duration_ms <= 0:
        raise HTTPException(status_code=400, detail="La durata totale della simulazione deve essere maggiore di 0")

    stimulus_record_id = None
    if stimuli and stimuli.filename:
        file_ext = stimuli.filename.split('.')[-1]
        object_name = f"stimuli/{current_user.id}/{uuid.uuid4()}.{file_ext}"
        minio_service.upload_file(stimuli.file, stimuli.size, object_name)
        new_stimulus = Stimulus(
            name=f"Stimolo per simulazione {network.name}",
            file_path=object_name,
            owner_id=current_user.id
        )
        db.add(new_stimulus)
        db.commit()
        db.refresh(new_stimulus)
        stimulus_record_id = new_stimulus.id

    simulation = Simulation(
        name=f"Simulazione - {network.name}",
        network_id=network.id,
        duration_ms=total_duration_ms,      
        experiment_params=parsed_params,     
        stimulus_id=stimulus_record_id,
        owner_id=current_user.id,
        status=SimulationStatus.PENDING
    )
    db.add(simulation)
    db.commit()
    db.refresh(simulation)

    # Il task id viene salvato qui, perfetto per la revoca futura
    task = run_simulation_task.delay(simulation.id, total_duration_ms, params)
    simulation.celery_task_id = task.id
    db.add(simulation)
    db.commit()

    return {"simulation_id": str(simulation.id)}

@router.get("/{id}", response_model=SimulationResponse)
def get_simulation(*, db: SessionDep, current_user: CurrentUser, id: int) -> Any:
    simulation = db.query(Simulation).filter(Simulation.id == id, Simulation.owner_id == current_user.id).first()
    if not simulation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
    return simulation

@router.get("/{id}/status")
def get_simulation_status(id: str, db: SessionDep, current_user: CurrentUser) -> dict:
    simulation = db.query(Simulation).filter(Simulation.id == int(id), Simulation.owner_id == current_user.id).first()
    if not simulation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulazione non trovata")
    
    current_status = simulation.status.value
    progress = 0

    if simulation.celery_task_id and current_status not in ["COMPLETED", "FAILED", "ABORTED"]:
        task_result = AsyncResult(simulation.celery_task_id, app=celery_app)
        if task_result.state == "PROGRESS":
            progress = task_result.info.get("current", 0)
            current_status = "RUNNING"
        elif task_result.state == "SUCCESS":
            progress = 100
            current_status = "COMPLETED"
        elif task_result.state in ["FAILURE", "REVOKED"]:
            current_status = "FAILED" if task_result.state == "FAILURE" else "ABORTED"
    elif current_status == "COMPLETED":
        progress = 100

    return {
        "status": current_status,
        "progress": progress,
        "network_id": str(simulation.network_id), # castato a stringa per consistenza col frontend
        "experiment_params": simulation.experiment_params
    }

@router.post("/{id}/abort")
def abort_simulation(id: str, db: SessionDep, current_user: CurrentUser) -> dict:
    simulation = db.query(Simulation).filter(Simulation.id == int(id), Simulation.owner_id == current_user.id).first()
    if not simulation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulazione non trovata")
    
    # Preveniamo l'interruzione di simulazioni già chiuse fornendo feedback chiaro
    if simulation.status in [SimulationStatus.COMPLETED, SimulationStatus.FAILED, SimulationStatus.ABORTED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=f"Impossibile interrompere. La simulazione è già in stato {simulation.status.value}"
        )
    
    if simulation.celery_task_id:
        try:
            # Invio del segnale SIGKILL protetto da blocco try
            celery_app.control.revoke(simulation.celery_task_id, terminate=True, signal='SIGKILL')
        except Exception as e:
            # Logghiamo l'errore del broker ma forziamo comunque lo stato DB per consistenza UI
            print(f"Errore durante l'invio del segnale SIGKILL a Celery: {e}")
        
    simulation.status = SimulationStatus.ABORTED
    db.add(simulation)
    db.commit()
    
    # Restituiamo un payload utile al frontend per aggiornare la UI all'istante
    return {"message": "Simulazione interrotta con successo", "status": "ABORTED"}

@router.get("/{id}/results")
def get_simulation_results(id: str, db: SessionDep, current_user: CurrentUser) -> dict:
    simulation = db.query(Simulation).filter(Simulation.id == int(id), Simulation.owner_id == current_user.id).first()
    if not simulation or simulation.status != SimulationStatus.COMPLETED or not simulation.results_path:
        raise HTTPException(status_code=404, detail="Risultati non disponibili")

    base_path = simulation.results_path
    network = db.query(Network).filter(Network.id == simulation.network_id).first()
    populations = network.definition.get("topology", {}).get("populations", [])

    # List all result objects once, up front, so we can both discover plots
    # and verify which per-population PNGs were actually generated.
    try:
        all_objects = list(minio_service.list_objects_with_prefix(base_path))
    except Exception as e:
        print(f"Errore elenco oggetti per sim {id}: {e}")
        all_objects = []
    existing_files = {obj.split("/")[-1] for obj in all_objects}

    # Per-population raster + PSTH — include a population only when its raster PNG
    # actually exists in storage. This keeps the section populated for any
    # experiment (built-in or topology-based) and self-corrects if plot
    # generation failed (the UI then shows the "no graphs" notice).
    population_graphs = []
    for pop in populations:
        pop_id = pop["id"]
        model_lower = pop["neuron_model"].lower()
        if "generator" in model_lower or "stimulus" in model_lower:
            continue
        if f"{pop_id}_raster.png" not in existing_files:
            continue
        population_graphs.append({
            "population_id": pop_id,
            "raster_url": minio_service.get_presigned_url(f"{base_path}/{pop_id}_raster.png"),
            "histogram_url": minio_service.get_presigned_url(f"{base_path}/{pop_id}_histogram.png"),
        })

    # Discover plots and artefacts from the already-listed objects
    differential_graphs = []
    race_model_graphs = []
    experiment_graphs = []
    response_graphs = []   # output-population activation + response-time CDF
    for obj_name in sorted(all_objects):
        filename = obj_name.split("/")[-1]
        if filename.startswith("diff_") and filename.endswith(".png"):
            label = filename[len("diff_"):-len(".png")].replace("_", " vs ", 1)
            differential_graphs.append({
                "label": label,
                "url": minio_service.get_presigned_url(obj_name),
            })
        elif filename.startswith("rmi_") and filename.endswith(".png"):
            pop_id = filename[len("rmi_"):-len(".png")]
            race_model_graphs.append({
                "population": pop_id,
                "url": minio_service.get_presigned_url(obj_name),
            })
        elif filename.startswith("exp_") and filename.endswith(".png"):
            # exp_A_vs_B_competition.png -> "A vs B competition"
            label = filename[len("exp_"):-len(".png")].replace("_", " ")
            experiment_graphs.append({
                "label": label,
                "url": minio_service.get_presigned_url(obj_name),
            })
        elif filename.startswith("activation_") and filename.endswith(".png"):
            pair = filename[len("activation_"):-len(".png")]
            response_graphs.append({
                "kind": "activation",
                "pair": pair,
                "url": minio_service.get_presigned_url(obj_name),
            })
        elif filename.startswith("cdf_") and filename.endswith(".png"):
            pair = filename[len("cdf_"):-len(".png")]
            response_graphs.append({
                "kind": "cdf",
                "pair": pair,
                "url": minio_service.get_presigned_url(obj_name),
            })

    # accuracy_metrics.json is only generated for trial-based protocols
    accuracy_metrics = None
    try:
        accuracy_metrics = minio_service.get_json_object(f"{base_path}/accuracy_metrics.json")
    except Exception:
        pass

    # race_model.json is only generated when race_model analysis is enabled
    race_model_data = None
    try:
        race_model_data = minio_service.get_json_object(f"{base_path}/race_model.json")
    except Exception:
        pass

    # experiment_metrics.json is generated by built-in experiments
    experiment_metrics = None
    try:
        experiment_metrics = minio_service.get_json_object(f"{base_path}/experiment_metrics.json")
    except Exception:
        pass

    # response_times.json: per output-pair response times grouped by condition
    response_analysis = None
    try:
        response_analysis = minio_service.get_json_object(f"{base_path}/response_times.json")
    except Exception:
        pass

    return {
        "network_id": str(simulation.network_id),
        "network_name": network.name,
        "duration_ms": simulation.duration_ms,
        "experiment_params": simulation.experiment_params,
        "raw_file_url": minio_service.get_presigned_url(f"{base_path}/spikes.json"),
        "graphs_zip_url": minio_service.get_presigned_url(f"{base_path}/graphs.zip"),
        "population_graphs": population_graphs,
        "differential_graphs": differential_graphs,
        "accuracy_metrics": accuracy_metrics,
        "race_model_graphs": race_model_graphs,
        "race_model_data": race_model_data,
        "experiment_graphs": experiment_graphs,
        "experiment_metrics": experiment_metrics,
        "response_graphs": response_graphs,
        "response_analysis": response_analysis,
    }

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_simulation(id: int, db: SessionDep, current_user: CurrentUser) -> None:
    simulation = db.query(Simulation).filter(Simulation.id == id, Simulation.owner_id == current_user.id).first()
    if not simulation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
    
    if simulation.results_path:
        try:
            minio_service.delete_directory(simulation.results_path)
        except Exception as e:
            print(f"Errore rimozione cartella risultati da MinIO: {e}")
            
    db.delete(simulation)
    db.commit()
    return None