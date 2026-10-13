from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from backend.api.deps import CurrentUser, SessionDep
from backend.models import Campaign, ReferenceSet
from backend.schemas import ReferenceSetResponse
from backend.services.reference_sets import MAX_FILE_BYTES, ReferenceFormatError, builtin_sets, parse_csv, summary

router = APIRouter(prefix="/references", tags=["Reference sets"])


def _user_response(reference: ReferenceSet) -> ReferenceSetResponse:
    return ReferenceSetResponse(key=f"user:{reference.id}", name=reference.name,
                                responses=summary(reference.conditions), deletable=True)


def resolve(db, key: str | None, user_id: int) -> dict | None:
    """Tempi per condizione del set indicato dalla chiave; None se non esiste (più)."""
    kind, _, identifier = (key or "").partition(":")
    if kind == "builtin":
        entry = builtin_sets().get(identifier)
        return entry and entry["conditions"]
    if kind == "user" and identifier.isdigit():
        reference = db.query(ReferenceSet).filter(ReferenceSet.id == int(identifier), ReferenceSet.owner_id == user_id).first()
        return reference and reference.conditions
    return None


@router.get("", response_model=List[ReferenceSetResponse])
def read_reference_sets(db: SessionDep, current_user: CurrentUser) -> list[ReferenceSetResponse]:
    builtin = [
        ReferenceSetResponse(key=f"builtin:{key}", name=entry["name"], source=entry.get("source"),
                             responses=summary(entry["conditions"]), deletable=False)
        for key, entry in builtin_sets().items()
    ]
    own = db.query(ReferenceSet).filter(ReferenceSet.owner_id == current_user.id).order_by(ReferenceSet.id.desc()).all()
    return builtin + [_user_response(reference) for reference in own]


@router.post("", response_model=ReferenceSetResponse, status_code=status.HTTP_201_CREATED)
def upload_reference_set(
    db: SessionDep,
    current_user: CurrentUser,
    name: str = Form(..., min_length=1, max_length=255),
    file: UploadFile = File(...),
) -> ReferenceSetResponse:
    """Carica un CSV con due colonne: condizione (A, V, AV, race) e tempo di risposta in ms."""
    raw = file.file.read(MAX_FILE_BYTES + 1)
    try:
        conditions = parse_csv(raw)
    except ReferenceFormatError as exc:
        raise HTTPException(422, str(exc)) from exc
    reference = ReferenceSet(name=name, owner_id=current_user.id, conditions=conditions)
    db.add(reference)
    db.commit()
    db.refresh(reference)
    return _user_response(reference)


@router.delete("/{reference_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reference_set(db: SessionDep, current_user: CurrentUser, reference_id: int) -> None:
    reference = db.query(ReferenceSet).filter(ReferenceSet.id == reference_id, ReferenceSet.owner_id == current_user.id).first()
    if not reference:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Set di riferimento non trovato")
    # Le campagne che lo usavano restano senza confronto.
    db.query(Campaign).filter(Campaign.owner_id == current_user.id, Campaign.reference == f"user:{reference.id}").update({"reference": None})
    db.delete(reference)
    db.commit()
