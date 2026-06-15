import io
import json
from datetime import timedelta
from typing import Any, List
from minio import Minio
from minio.error import S3Error
from backend.core.config import settings

class MinioService:
    def __init__(self) -> None:
        # 1. CLIENT INTERNO (Docker-to-Docker)
        self.client = Minio(
            settings.MINIO_URL,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
            region="us-east-1"  # <-- Evita chiamate di network inutili
        )
        
        # 2. CLIENT ESTERNO (Generazione URL per il Browser)
        self.external_client = Minio(
            settings.MINIO_EXTERNAL_URL,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
            region="us-east-1"  # <-- FONDAMENTALE: blocca la richiesta a localhost!
        )

        self.bucket_name = settings.MINIO_BUCKET_NAME
        self.initialize_bucket()

    def initialize_bucket(self) -> None:
        """Controlla se il bucket esiste tramite la rete interna, altrimenti lo crea."""
        try:
            found = self.client.bucket_exists(self.bucket_name)
            if not found:
                self.client.make_bucket(self.bucket_name)
        except S3Error as e:
            print(f"Errore inizializzazione MinIO: {e}")
            raise

    def upload_file(self, file_stream: Any, file_size: int, object_name: str, content_type: str = "application/octet-stream") -> str:
        """Carica un file stream su MinIO usando la rete interna ultra-veloce."""
        try:
            self.client.put_object(
                bucket_name=self.bucket_name,
                object_name=object_name,
                data=file_stream,
                length=file_size,
                content_type=content_type
            )
            return object_name
        except S3Error as e:
            print(f"Errore upload MinIO: {e}")
            raise

    def get_presigned_url(self, object_name: str, expires: timedelta = timedelta(hours=1)) -> str:
        """Genera un URL presigned calcolando la firma con il dominio PUBBLICO (external_client)."""
        try:
            url = self.external_client.presigned_get_object(
                bucket_name=self.bucket_name,
                object_name=object_name,
                expires=expires
            )
            return url
        except S3Error as e:
            print(f"Errore generazione URL MinIO: {e}")
            raise
        
    def delete_directory(self, prefix: str) -> None:
        """Elimina tutti i file all'interno di un percorso (folder) su MinIO."""
        try:
            objects_to_delete = self.client.list_objects(self.bucket_name, prefix=prefix, recursive=True)
            for obj in objects_to_delete:
                self.client.remove_object(self.bucket_name, obj.object_name)
        except S3Error as e:
            print(f"Errore cancellazione directory MinIO {prefix}: {e}")

    def list_objects_with_prefix(self, prefix: str) -> List[str]:
        """Restituisce i nomi di tutti gli oggetti sotto il prefisso dato."""
        try:
            objects = self.client.list_objects(self.bucket_name, prefix=prefix, recursive=True)
            return [obj.object_name for obj in objects]
        except S3Error as e:
            print(f"Errore listing MinIO {prefix}: {e}")
            return []

    def get_json_object(self, object_name: str) -> dict:
        """Scarica e deserializza un oggetto JSON da MinIO tramite la rete interna."""
        response = self.client.get_object(self.bucket_name, object_name)
        try:
            content = response.read()
            return json.loads(content.decode("utf-8"))
        finally:
            response.close()
            response.release_conn()

minio_service = MinioService()