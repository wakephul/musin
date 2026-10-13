"""File delle simulazioni (grafici, metriche, spike) e degli stimoli su disco.

API e worker montano la stessa cartella (`STORAGE_DIR`). Il browser scarica i file
dall'API con link firmati a scadenza: un tag <img> non può mandare il token di accesso.
"""
import hashlib
import hmac
import json
import shutil
import time
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

from backend.core.config import settings

LINK_LIFETIME = timedelta(hours=1)


class FileStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()

    def path(self, name: str) -> Path:
        """Percorso su disco di `name`; rifiuta i nomi che escono dalla cartella dello storage."""
        path = (self.root / name).resolve()
        if path == self.root or not path.is_relative_to(self.root):
            raise ValueError(f"Percorso fuori dallo storage: {name}")
        # I file nascosti della radice (la chiave segreta) non sono contenuto dello storage.
        if any(part.startswith(".") for part in path.relative_to(self.root).parts):
            raise ValueError(f"Percorso non ammesso: {name}")
        return path

    def write(self, name: str, data: bytes) -> str:
        path = self.path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return name

    def write_json(self, name: str, obj: Any) -> str:
        return self.write(name, json.dumps(obj).encode("utf-8"))

    def read_json(self, name: str) -> Any:
        return json.loads(self.path(name).read_bytes())

    def list(self, directory: str) -> list[str]:
        """Nomi (relativi allo storage) di tutti i file sotto `directory`."""
        base = self.path(directory)
        if not base.is_dir():
            return []
        return sorted(str(path.relative_to(self.root)) for path in base.rglob("*") if path.is_file())

    def delete(self, name: str) -> None:
        self.path(name).unlink(missing_ok=True)

    def delete_tree(self, directory: str) -> None:
        shutil.rmtree(self.path(directory), ignore_errors=True)

    # --- Link firmati ---

    def _signature(self, name: str, expires: int) -> str:
        message = f"files:{expires}:{name}".encode("utf-8")
        return hmac.new(settings.SECRET_KEY.encode("utf-8"), message, hashlib.sha256).hexdigest()

    def signed_url(self, name: str, lifetime: timedelta = LINK_LIFETIME) -> str:
        expires = int(time.time() + lifetime.total_seconds())
        return f"{settings.API_V1_STR}/files/{quote(name)}?expires={expires}&signature={self._signature(name, expires)}"

    def verify(self, name: str, expires: int, signature: str) -> Path | None:
        """Percorso del file se il link è autentico e non scaduto, altrimenti None."""
        if expires < time.time() or not hmac.compare_digest(self._signature(name, expires), signature):
            return None
        try:
            return self.path(name)
        except ValueError:
            return None


storage = FileStorage(settings.STORAGE_DIR)
