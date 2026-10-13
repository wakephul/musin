import uuid
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from backend.api.deps import CurrentUser, SessionDep
from backend.core.config import settings
from backend.models import Stimulus
from backend.schemas import StimulusResponse
from backend.services.minio_client import minio_service
from backend.services.stimulus_files import StimulusFormatError, parse_stimulus_file, summarize

router = APIRouter(prefix="/stimuli", tags=["Stimuli"])


def _get_owned_stimulus(db, stimulus_id: int, user_id: int) -> Stimulus:
    stimulus = db.query(Stimulus).filter(Stimulus.id == stimulus_id, Stimulus.owner_id == user_id).first()
    if not stimulus:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stimolo non trovato")
    return stimulus


@router.get("", response_model=List[StimulusResponse])
def read_stimuli(db: SessionDep, current_user: CurrentUser) -> list[Stimulus]:
    return db.query(Stimulus).filter(Stimulus.owner_id == current_user.id).order_by(Stimulus.id.desc()).all()


@router.post("/upload", response_model=StimulusResponse, status_code=status.HTTP_201_CREATED)
def upload_stimulus(
    db: SessionDep,
    current_user: CurrentUser,
    name: str = Form(..., min_length=1, max_length=255),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
) -> Stimulus:
    """Carica un file di treni di spike. Viene salvato in formato normalizzato
    ({"spike_trains": [[ms, ...], ...]}), così il worker non deve conoscere i formati."""
    raw = file.file.read(settings.MAX_STIMULUS_UPLOAD_BYTES + 1)
    if len(raw) > settings.MAX_STIMULUS_UPLOAD_BYTES:
        raise HTTPException(413, "File troppo grande (massimo 20 MB)")
    try:
        trains = parse_stimulus_file(file.filename or "", raw)
    except StimulusFormatError as exc:
        raise HTTPException(422, str(exc)) from exc

    object_name = f"stimuli/{current_user.id}/{uuid.uuid4()}.json"
    minio_service.upload_json(object_name, {"spike_trains": trains})

    stimulus = Stimulus(
        name=name,
        description=description,
        file_path=object_name,
        definition={**summarize(trains), "source_filename": file.filename},
        owner_id=current_user.id,
    )
    db.add(stimulus)
    db.commit()
    db.refresh(stimulus)
    return stimulus


@router.get("/{stimulus_id}", response_model=StimulusResponse)
def read_stimulus(db: SessionDep, current_user: CurrentUser, stimulus_id: int) -> Stimulus:
    return _get_owned_stimulus(db, stimulus_id, current_user.id)


@router.delete("/{stimulus_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stimulus(db: SessionDep, current_user: CurrentUser, stimulus_id: int) -> None:
    stimulus = _get_owned_stimulus(db, stimulus_id, current_user.id)
    if stimulus.file_path:
        minio_service.delete_object(stimulus.file_path)
    db.delete(stimulus)
    db.commit()
