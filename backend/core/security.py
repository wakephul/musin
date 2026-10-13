from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from backend.core.config import settings

# bcrypt ignora tutto oltre i 72 byte: lo schema di registrazione limita la lunghezza,
# qui il troncamento evita solo l'eccezione sulle password già esistenti.
BCRYPT_MAX_BYTES = 72


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"exp": expire, "sub": str(user_id)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:BCRYPT_MAX_BYTES], bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8")[:BCRYPT_MAX_BYTES], hashed_password.encode("utf-8"))
