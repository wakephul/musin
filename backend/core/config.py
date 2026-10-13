import os
import secrets
import time
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Valori pubblicati nel repository: chi li conosce può firmare token e link.
PUBLISHED_SECRET_KEYS = {
    "",
    "super-secret-key-change-in-production",
    "change_me_generate_with_openssl_rand_hex_32",
}
PUBLISHED_PASSWORDS = {"admin", "change_me", "change_me_at_least_8_chars"}


class Settings(BaseSettings):
    PROJECT_NAME: str = "MuSiN API"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"

    # Vuota: ne viene generata una al primo avvio e salvata in STORAGE_DIR.
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # Il frontend parla con l'API attraverso lo stesso host (nginx o proxy di ng serve):
    # servono origini CORS solo se l'API viene chiamata da un altro dominio.
    CORS_ORIGINS: str = ""
    ALLOW_REGISTRATION: bool = True

    FIRST_SUPERUSER_EMAIL: str = "admin@example.com"
    FIRST_SUPERUSER_PASSWORD: str = "admin"

    DATABASE_URL: str = "mysql+pymysql://root:password@localhost:3306/musin_db"

    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"

    # Cartella dei risultati e degli stimoli, condivisa tra API e worker.
    STORAGE_DIR: str = "/data"

    # Tetto al tempo biologico di una singola simulazione (1 ora): evita che un
    # parametro sbagliato occupi il worker per giorni.
    MAX_SIMULATION_MS: float = 3_600_000.0
    MAX_STIMULUS_UPLOAD_BYTES: int = 20 * 1024 * 1024

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @model_validator(mode="after")
    def _never_use_published_secrets(self) -> "Settings":
        if self.SECRET_KEY in PUBLISHED_SECRET_KEYS:
            self.SECRET_KEY = _stored_secret_key(Path(self.STORAGE_DIR))
        if self.ENVIRONMENT != "development" and self.FIRST_SUPERUSER_PASSWORD in PUBLISHED_PASSWORDS:
            raise ValueError("FIRST_SUPERUSER_PASSWORD è quella di esempio: scegline una prima di esporre il servizio.")
        return self


def _stored_secret_key(storage_dir: Path) -> str:
    """Chiave generata al primo avvio e riletta ai successivi, così token e link
    firmati restano validi dopo un riavvio. Senza cartella scrivibile vale per il solo processo."""
    key_file = storage_dir / ".secret_key"
    try:
        storage_dir.mkdir(parents=True, exist_ok=True)
        try:
            # Creazione esclusiva: API e worker partono insieme e solo uno deve scriverla.
            with os.fdopen(os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                handle.write(secrets.token_hex(32))
        except FileExistsError:
            pass
        for _ in range(20):   # l'altro processo può averla creata e non ancora scritta
            key = key_file.read_text().strip()
            if key:
                return key
            time.sleep(0.05)
    except OSError:
        pass
    return secrets.token_hex(32)


settings = Settings()
