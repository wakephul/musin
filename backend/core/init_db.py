import logging

from backend.core.config import settings
from backend.core.db import SessionLocal
from backend.core.security import get_password_hash
from backend.models import User

logger = logging.getLogger(__name__)


def init_superuser() -> None:
    """Crea l'utente iniziale al primo avvio, se non esiste."""
    with SessionLocal() as db:
        if db.query(User).filter(User.email == settings.FIRST_SUPERUSER_EMAIL).first():
            return
        db.add(User(
            email=settings.FIRST_SUPERUSER_EMAIL,
            hashed_password=get_password_hash(settings.FIRST_SUPERUSER_PASSWORD),
            is_active=True,
        ))
        db.commit()
        logger.info("Utente iniziale %s creato.", settings.FIRST_SUPERUSER_EMAIL)
