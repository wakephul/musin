"""Scrittura degli artefatti di una simulazione nello storage e nello zip scaricabile."""
import io
import json
import zipfile
from pathlib import PurePosixPath

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


class ResultStore:
    """Salva ogni artefatto in `base_path` e ne tiene una copia in `graphs.zip`."""

    def __init__(self, storage, base_path: str):
        self._storage = storage
        self.base_path = base_path
        self._zip_buffer = io.BytesIO()
        self._zip = zipfile.ZipFile(self._zip_buffer, "w", zipfile.ZIP_DEFLATED)

    def put(self, name: str, data: bytes, in_zip: bool = True) -> None:
        # I nomi derivano dagli id di popolazione: un separatore di percorso farebbe
        # scrivere fuori dalla cartella di questa simulazione.
        if PurePosixPath(name).name != name or "\\" in name or name.startswith("."):
            raise ValueError(f"Nome di file non valido: {name}")
        self._storage.write(f"{self.base_path}/{name}", data)
        if in_zip:
            self._zip.writestr(name, data)

    def put_json(self, name: str, obj, in_zip: bool = True) -> None:
        self.put(name, json.dumps(obj, indent=2).encode("utf-8"), in_zip)

    def put_figure(self, name: str, fig=None, dpi: int = 150) -> None:
        fig = fig or plt.gcf()
        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=dpi, bbox_inches="tight")
        plt.close(fig)
        self.put(name, buffer.getvalue())

    def close(self) -> None:
        self._zip.close()
        self._storage.write(f"{self.base_path}/graphs.zip", self._zip_buffer.getvalue())
