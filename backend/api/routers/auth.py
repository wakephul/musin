from datetime import timedelta
from typing import Annotated, Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from backend.api.deps import SessionDep, CurrentUser
from backend.core.security import verify_password, create_access_token
from backend.core.config import settings
from backend.models import User
from backend.schemas import Token

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/login", response_model=Token)
def login_access_token(
    db: SessionDep, 
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Any:
    """
    Login con Logging per Debugging.
    """
    # --- LOG DI DEBUG ---
    print(f"\n--- TENTATIVO DI LOGIN ---")
    print(f"Email ricevuta: {form_data.username}")
    print(f"Password ricevuta (lunghezza): {len(form_data.password)}")

    # 1. Cerca l'utente
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if not user:
        print(f"❌ UTENTE NON TROVATO nel database per email: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o password non corretti",
        )

    print(f"✅ Utente trovato: {user.email} (ID: {user.id})")
    print(f"utenti esistenti in DB: {[u.email for u in db.query(User).all()]}")

    # 2. Verifica la password
    is_valid = verify_password(form_data.password, user.hashed_password)
    
    if not is_valid:
        print(f"❌ PASSWORD ERRATA per l'utente: {user.email}")
        # Log di sicurezza extra (attenzione in produzione)
        # print(f"Hash nel DB: {user.hashed_password}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o password non corretti",
        )

    print(f"✅ Login riuscito per: {user.email}")
    print(f"--------------------------\n")

    # 3. Generazione Token
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.id, expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }