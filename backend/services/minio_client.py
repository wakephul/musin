import io
import json
import logging
from datetime import timedelta
from typing import Any, List

from minio import Minio
from minio.error import S3Error

from backend.core.config import settings

logger = logging.getLogger(__name__)


class MinioService:
    """Accesso a MinIO. Il bucket viene creato al primo utilizzo, non all'import."""

    def __init__(self) -> None:
        self.bucket_name = settings.MINIO_BUCKET_NAME
        self._client: Minio | None = None
        # Client separato per firmare gli URL con l'host visto dal browser. La regione
        # esplicita evita che la firma richieda una chiamata di rete verso quell'host.
        self._external_client = self._build_client(settings.MINIO_EXTERNAL_URL)

    @staticmethod
    def _build_client(endpoint: str) -> Minio:
        return Minio(
            endpoint,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
            region="us-east-1",
        )

    @property
    def client(self) -> Minio:
        if self._client is None:
            client = self._build_client(settings.MINIO_URL)
            if not client.bucket_exists(self.bucket_name):
                client.make_bucket(self.bucket_name)
            self._client = client
        return self._client

    def upload_file(self, file_stream: Any, file_size: int, object_name: str, content_type: str = "application/octet-stream") -> str:
        self.client.put_object(
            bucket_name=self.bucket_name,
            object_name=object_name,
            data=file_stream,
            length=file_size,
            content_type=content_type,
        )
        return object_name

    def upload_json(self, object_name: str, obj: Any) -> str:
        data = json.dumps(obj).encode("utf-8")
        return self.upload_file(io.BytesIO(data), len(data), object_name, "application/json")

    def get_presigned_url(self, object_name: str, expires: timedelta = timedelta(hours=1)) -> str:
        return self._external_client.presigned_get_object(
            bucket_name=self.bucket_name, object_name=object_name, expires=expires
        )

    def delete_object(self, object_name: str) -> None:
        try:
            self.client.remove_object(self.bucket_name, object_name)
        except S3Error as exc:
            logger.warning("Rimozione di %s da MinIO fallita: %s", object_name, exc)

    def delete_directory(self, prefix: str) -> None:
        """Elimina tutti gli oggetti sotto `prefix/` (lo slash evita che sim_1 cancelli sim_10)."""
        try:
            for obj in self.client.list_objects(self.bucket_name, prefix=prefix.rstrip("/") + "/", recursive=True):
                self.client.remove_object(self.bucket_name, obj.object_name)
        except S3Error as exc:
            logger.warning("Rimozione di %s da MinIO fallita: %s", prefix, exc)

    def list_objects_with_prefix(self, prefix: str) -> List[str]:
        objects = self.client.list_objects(self.bucket_name, prefix=prefix.rstrip("/") + "/", recursive=True)
        return [obj.object_name for obj in objects]

    def get_json_object(self, object_name: str) -> Any:
        response = self.client.get_object(self.bucket_name, object_name)
        try:
            return json.loads(response.read().decode("utf-8"))
        finally:
            response.close()
            response.release_conn()


minio_service = MinioService()
