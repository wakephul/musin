"""Scrittura degli artefatti di una simulazione su MinIO e nello zip scaricabile."""
import io
import json
import zipfile

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


class ResultStore:
    """Carica ogni artefatto in `base_path` e ne tiene una copia in `graphs.zip`."""

    def __init__(self, minio_service, base_path: str):
        self._minio = minio_service
        self.base_path = base_path
        self._zip_buffer = io.BytesIO()
        self._zip = zipfile.ZipFile(self._zip_buffer, "w", zipfile.ZIP_DEFLATED)

    def put(self, name: str, data: bytes, content_type: str, in_zip: bool = True) -> None:
        self._minio.upload_file(io.BytesIO(data), len(data), f"{self.base_path}/{name}", content_type)
        if in_zip:
            self._zip.writestr(name, data)

    def put_json(self, name: str, obj, in_zip: bool = True) -> None:
        self.put(name, json.dumps(obj, indent=2).encode("utf-8"), "application/json", in_zip)

    def put_figure(self, name: str, fig=None, dpi: int = 150) -> None:
        fig = fig or plt.gcf()
        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=dpi, bbox_inches="tight")
        plt.close(fig)
        self.put(name, buffer.getvalue(), "image/png")

    def close(self) -> None:
        self._zip.close()
        data = self._zip_buffer.getvalue()
        self._minio.upload_file(io.BytesIO(data), len(data), f"{self.base_path}/graphs.zip", "application/zip")
