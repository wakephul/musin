from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.api.deps import CurrentUser, SessionDep
from backend.core.config import settings
from backend.core.security import create_access_token, get_password_hash, verify_password
from backend.models import User
from backend.schemas import PasswordChange, Token, UserCreate, UserResponse

router = APIRouter(prefix="/auth", tags=["Auth"])


def _token_for(user: User) -> dict:
    return {"access_token": create_access_token(user.id), "token_type": "bearer", "user": user}


@router.get("/config")
def auth_config() -> dict:
    return {"registration_enabled": settings.ALLOW_REGISTRATION}


@router.post("/login", response_model=Token)
def login(db: SessionDep, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]) -> dict:
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not user.is_active or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email o password non corretti")
    return _token_for(user)


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(db: SessionDep, user_in: UserCreate) -> dict:
    if not settings.ALLOW_REGISTRATION:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "La registrazione è disattivata su questa installazione")
    if db.query(User).filter(User.email == user_in.email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Esiste già un account con questa email")
    user = User(email=user_in.email, hashed_password=get_password_hash(user_in.password), is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_for(user)


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: CurrentUser) -> User:
    return current_user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(db: SessionDep, current_user: CurrentUser, body: PasswordChange) -> None:
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La password attuale non è corretta")
    current_user.hashed_password = get_password_hash(body.new_password)
    db.add(current_user)
    db.commit()
