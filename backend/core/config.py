from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRET_KEYS = {
    "super-secret-key-change-in-production",
    "change_me_generate_with_openssl_rand_hex_32",
}


class Settings(BaseSettings):
    PROJECT_NAME: str = "MuSiN API"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"

    SECRET_KEY: str = "super-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # Il frontend parla con l'API attraverso lo stesso host (nginx o proxy di ng serve):
    # servono origini CORS solo se l'API viene chiamata da un altro dominio.
    CORS_ORIGINS: str = ""
    ALLOW_REGISTRATION: bool = True

    FIRST_SUPERUSER_EMAIL: str = "admin@musin.local"
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
    def _refuse_default_secrets_outside_development(self) -> "Settings":
        if self.ENVIRONMENT != "development" and self.SECRET_KEY in INSECURE_SECRET_KEYS:
            raise ValueError("SECRET_KEY è quella di esempio: generane una con `openssl rand -hex 32`.")
        return self


settings = Settings()
