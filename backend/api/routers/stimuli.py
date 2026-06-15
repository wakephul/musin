import uuid
import copy
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form, Depends
from backend.api.deps import SessionDep, CurrentUser
from backend.models import Stimulus
from backend.schemas import StimulusCreate, StimulusResponse, StimulusBase
from backend.services.minio_client import minio_service

router = APIRouter(prefix="/stimuli", tags=["Stimuli"])

@router.get("", response_model=List[StimulusResponse])
def read_stimuli(db: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100) -> Any:
    """Recupera la lista degli stimoli dell'utente."""
    stimuli = db.query(Stimulus).filter(Stimulus.owner_id == current_user.id).offset(skip).limit(limit).all()
    return stimuli

@router.post("", response_model=StimulusResponse, status_code=status.HTTP_201_CREATED)
def create_stimulus(*, db: SessionDep, current_user: CurrentUser, stimulus_in: StimulusCreate) -> Any:
    """Crea uno stimolo basato su JSON (senza file binario)."""
    stimulus = Stimulus(
        name=stimulus_in.name,
        description=stimulus_in.description,
        definition=stimulus_in.definition,
        owner_id=current_user.id
    )
    db.add(stimulus)
    db.commit()
    db.refresh(stimulus)
    return stimulus

@router.post("/upload", response_model=StimulusResponse, status_code=status.HTTP_201_CREATED)
def upload_stimulus(
    *, 
    db: SessionDep, 
    current_user: CurrentUser, 
    name: str = Form(...),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...)
) -> Any:
    """Carica un file binario di stimolo su MinIO e salva il riferimento su DB."""
    if not file.size:
        raise HTTPException(status_code=400, detail="Il file è vuoto")

    # Genera un object name univoco per evitare collisioni su MinIO
    file_extension = file.filename.split('.')[-1] if file.filename else "bin"
    object_name = f"stimuli/{current_user.id}/{uuid.uuid4()}.{file_extension}"
    
    try:
        minio_service.upload_file(
            file_stream=file.file,
            file_size=file.size,
            object_name=object_name,
            content_type=file.content_type or "application/octet-stream"
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Errore di storage: {str(e)}")

    stimulus = Stimulus(
        name=name,
        description=description,
        file_path=object_name,
        owner_id=current_user.id
    )
    db.add(stimulus)
    db.commit()
    db.refresh(stimulus)
    return stimulus

@router.get("/{id}", response_model=StimulusResponse)
def read_stimulus(*, db: SessionDep, current_user: CurrentUser, id: int) -> Any:
    """Recupera i dettagli di uno stimolo."""
    stimulus = db.query(Stimulus).filter(Stimulus.id == id, Stimulus.owner_id == current_user.id).first()
    if not stimulus:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stimulus not found")
    return stimulus

@router.post("/{id}/fork", response_model=StimulusResponse, status_code=status.HTTP_201_CREATED)
def fork_stimulus(
    *, 
    db: SessionDep, 
    current_user: CurrentUser, 
    id: int, 
    new_name: str = Form(...)
) -> Any:
    """Crea una nuova versione di uno stimolo esistente (mantiene lo stesso riferimento al file in MinIO)."""
    original = db.query(Stimulus).filter(Stimulus.id == id).first()
    if not original:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original stimulus not found")
    
    cloned_definition = copy.deepcopy(original.definition) if original.definition else None
    
    new_stimulus = Stimulus(
        name=new_name,
        description=original.description,
        file_path=original.file_path,  # Condivide lo storage dell'originale
        definition=cloned_definition,
        parent_id=original.id,
        owner_id=current_user.id
    )
    db.add(new_stimulus)
    db.commit()
    db.refresh(new_stimulus)
    return new_stimulus