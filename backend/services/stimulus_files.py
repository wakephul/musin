"""Lettura dei file di stimolo caricati dall'utente.

Formati accettati, tempi in millisecondi:
  * JSON  {"spike_trains": [[t, ...], ...]}
  * JSON  {"senders": [...], "times": [...]}  (eventi di uno spike_recorder NEST;
          vale anche per un singolo blocco popolazione del file "spikes.json" esportato)
  * CSV   due colonne `sender,time`, con o senza intestazione
  * HDF5  dataset `senders` e `times`
"""
import csv
import io
import json

MAX_TRAINS = 5000


class StimulusFormatError(ValueError):
    pass


def _trains_from_events(senders, times) -> list[list[float]]:
    if len(senders) != len(times):
        raise StimulusFormatError("'senders' e 'times' hanno lunghezze diverse")
    by_sender: dict = {}
    for sender, time in zip(senders, times):
        by_sender.setdefault(int(sender), []).append(float(time))
    return [by_sender[sender] for sender in sorted(by_sender)]


def _parse_json(raw: bytes) -> list[list[float]]:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StimulusFormatError(f"JSON non valido: {exc}") from exc
    if isinstance(data, dict) and "spike_trains" in data:
        return [[float(t) for t in train] for train in data["spike_trains"]]
    if isinstance(data, dict) and "senders" in data and "times" in data:
        return _trains_from_events(data["senders"], data["times"])
    raise StimulusFormatError("Il JSON deve contenere 'spike_trains' oppure 'senders' e 'times'")


def _parse_csv(raw: bytes) -> list[list[float]]:
    senders, times = [], []
    for row in csv.reader(io.StringIO(raw.decode("utf-8-sig"))):
        if len(row) < 2:
            continue
        try:
            sender, time = int(float(row[0])), float(row[1])
        except ValueError:
            if not senders:  # intestazione
                continue
            raise StimulusFormatError(f"Riga non numerica: {row}") from None
        senders.append(sender)
        times.append(time)
    return _trains_from_events(senders, times)


def _parse_hdf5(raw: bytes) -> list[list[float]]:
    import h5py

    try:
        with h5py.File(io.BytesIO(raw), "r") as handle:
            if "senders" not in handle or "times" not in handle:
                raise StimulusFormatError("Il file HDF5 deve contenere i dataset 'senders' e 'times'")
            return _trains_from_events(handle["senders"][()].tolist(), handle["times"][()].tolist())
    except OSError as exc:
        raise StimulusFormatError(f"HDF5 non leggibile: {exc}") from exc


def parse_stimulus_file(filename: str, raw: bytes) -> list[list[float]]:
    """Restituisce i treni di spike (ms, ordinati, senza tempi ≤ 0) contenuti nel file."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    parser = {"json": _parse_json, "csv": _parse_csv, "h5": _parse_hdf5, "hdf5": _parse_hdf5}.get(extension)
    if parser is None:
        raise StimulusFormatError("Formato non supportato: usa .json, .csv, .h5 o .hdf5")
    try:
        trains = parser(raw)
    except (TypeError, ValueError) as exc:
        if isinstance(exc, StimulusFormatError):
            raise
        raise StimulusFormatError(f"Contenuto non valido: {exc}") from exc

    trains = [sorted({round(t, 1) for t in train if t > 0}) for train in trains]
    trains = [train for train in trains if train]
    if not trains:
        raise StimulusFormatError("Il file non contiene spike")
    if len(trains) > MAX_TRAINS:
        raise StimulusFormatError(f"Troppi treni di spike ({len(trains)}): il massimo è {MAX_TRAINS}")
    return trains


def summarize(trains: list[list[float]]) -> dict:
    return {
        "n_trains": len(trains),
        "n_spikes": sum(len(train) for train in trains),
        "duration_ms": max(train[-1] for train in trains),
    }
