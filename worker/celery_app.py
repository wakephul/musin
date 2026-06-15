from celery import Celery
from backend.core.config import settings

# Inizializzazione dell'app Celery collegata a Redis
celery_app = Celery(
    "musin_worker",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["worker.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Impostazioni utili per task pesanti di simulazione
    task_acks_late=True,
    worker_prefetch_multiplier=1
)