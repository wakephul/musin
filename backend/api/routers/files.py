import mimetypes

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from backend.services.storage import storage

router = APIRouter(prefix="/files", tags=["Files"])


@router.get("/{name:path}")
def download_file(name: str, expires: int, signature: str) -> FileResponse:
    """Scarica un file dello storage. Non richiede il token: l'accesso è dato dalla firma
    del link, che l'API rilascia solo al proprietario (vedi i risultati di una simulazione)."""
    path = storage.verify(name, expires, signature)
    if path is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Link non valido o scaduto")
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File non trovato")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    # Le immagini si mostrano nella pagina, tutto il resto si scarica.
    download_name = None if media_type.startswith("image/") else path.name
    return FileResponse(path, media_type=media_type, filename=download_name,
                        headers={"Cache-Control": "private, max-age=3600"})
