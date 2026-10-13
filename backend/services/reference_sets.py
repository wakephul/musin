"""Set di riferimento: tempi di risposta per condizione con cui confrontare una campagna.
Quelli del paper sono in backend/data; gli altri li carica l'utente come CSV."""
import csv
import io
import json
import math
from functools import lru_cache
from pathlib import Path

BUILTIN_FILE = Path(__file__).resolve().parent.parent / "data" / "reference_sets.json"
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_VALUES = 100_000
MAX_RESPONSE_MS = 60_000.0
LABELS = {"a": "A", "v": "V", "av": "AV", "race": "race", "gara": "race"}


class ReferenceFormatError(ValueError):
    pass


@lru_cache(maxsize=1)
def builtin_sets() -> dict:
    """I set inclusi, per chiave."""
    return {entry["key"]: entry for entry in json.loads(BUILTIN_FILE.read_text(encoding="utf-8"))}


def summary(conditions: dict) -> dict:
    """Numero di tempi per condizione: ciò che gli elenchi mostrano al posto dei dati."""
    return {label: len(values) for label, values in conditions.items()}


def parse_csv(content: bytes) -> dict:
    """Due colonne, condizione (A, V, AV, race) e tempo in ms; la riga di intestazione è facoltativa.
    Separatore virgola, punto e virgola o tabulazione; con gli ultimi due la virgola decimale è ammessa."""
    if len(content) > MAX_FILE_BYTES:
        raise ReferenceFormatError("Il file supera i 2 MB")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ReferenceFormatError("Il file non è testo UTF-8") from exc
    first_line = text.split("\n", 1)[0]
    delimiter = next((d for d in (";", "\t") if d in first_line), ",")

    conditions: dict = {}
    count = 0
    for number, row in enumerate(csv.reader(io.StringIO(text), delimiter=delimiter), start=1):
        cells = [cell.strip() for cell in row]
        if not any(cells):
            continue
        if len(cells) < 2:
            raise ReferenceFormatError(f"Riga {number}: servono due colonne, condizione e tempo")
        raw = cells[1].replace(",", ".") if delimiter != "," else cells[1]
        try:
            value = float(raw)
        except ValueError:
            if number == 1:      # intestazione
                continue
            raise ReferenceFormatError(f"Riga {number}: '{cells[1]}' non è un numero") from None
        label = LABELS.get(cells[0].lower())
        if label is None:
            raise ReferenceFormatError(f"Riga {number}: la condizione deve essere A, V, AV o race, non '{cells[0]}'")
        if not math.isfinite(value) or not 0 < value <= MAX_RESPONSE_MS:
            raise ReferenceFormatError(f"Riga {number}: il tempo deve essere tra 0 e {MAX_RESPONSE_MS:g} ms")
        count += 1
        if count > MAX_VALUES:
            raise ReferenceFormatError(f"Il file ha più di {MAX_VALUES} tempi")
        conditions.setdefault(label, []).append(round(value, 1))

    if not any(len(values) >= 2 for values in conditions.values()):
        raise ReferenceFormatError("Servono almeno due tempi di risposta in una condizione")
    return conditions
