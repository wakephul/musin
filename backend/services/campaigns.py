"""Campagne: lo stesso esperimento con più seed e, se indicato, un parametro che varia.
Qui stanno la composizione dei parametri di ogni simulazione e il riepilogo dei risultati."""
import copy
import math
import re

from backend.models import Campaign, Simulation
from backend.services.experiments import experiment_kind
from backend.services.storage import storage
from worker.analysis import (
    PAPER_PERCENTILES, median_ci, median_difference_ci, median_or_none, percentiles, race_model_inequality,
)

MAX_CAMPAIGN_SIMULATIONS = 50
MAX_SWEEP_VALUES = 20
SWEEP_PATH = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,3}$")

# Ordine in cui il riepilogo elenca le condizioni; "race" è il modello a gara a coppie.
CONDITIONS = ("A", "V", "AV", "race")


class CampaignError(ValueError):
    pass


def seed_path(params: dict) -> tuple:
    """Dove sta il seed nei parametri: la rete di decisione lo tiene nella propria sezione."""
    return ("decision_making", "seed") if experiment_kind(params) == "decision_making" else ("seed",)


def _set(params: dict, path: tuple, value) -> None:
    section = params
    for key in path[:-1]:
        child = section.get(key)
        if child is None:
            child = section[key] = {}
        if not isinstance(child, dict):
            raise CampaignError(f"'{'.'.join(path)}' non è un parametro: '{key}' non è una sezione")
        section = child
    current = section.get(path[-1])
    if isinstance(current, (dict, list, str, bool)):
        raise CampaignError(f"'{'.'.join(path)}' non è un parametro numerico")
    section[path[-1]] = value


def check_sweep(params: dict, sweep: dict | None) -> None:
    if sweep is None:
        return
    path, values = sweep.get("path"), sweep.get("values")
    if not isinstance(path, str) or not SWEEP_PATH.match(path):
        raise CampaignError("Il parametro da variare non è valido")
    if tuple(path.split(".")) == seed_path(params):
        raise CampaignError("Il seed non può essere il parametro da variare: i seed sono già le ripetizioni")
    if not isinstance(values, list) or not 2 <= len(values) <= MAX_SWEEP_VALUES:
        raise CampaignError(f"Servono da 2 a {MAX_SWEEP_VALUES} valori per il parametro da variare")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise CampaignError("I valori del parametro da variare devono essere numeri")
    if len(set(values)) != len(values):
        raise CampaignError("I valori del parametro da variare devono essere tutti diversi")


def expand(params: dict, seeds: list, sweep: dict | None, save_spikes: bool = False) -> list:
    """Una voce (seed, valore, parametri) per ogni simulazione della campagna."""
    if not seeds or len(set(seeds)) != len(seeds):
        raise CampaignError("I seed devono essere almeno uno e tutti diversi")
    check_sweep(params, sweep)
    # 150.0 torna 150: i parametri interi (numero di trial, di neuroni) restano interi.
    values = [int(v) if float(v).is_integer() else v for v in sweep["values"]] if sweep else [None]
    if len(seeds) * len(values) > MAX_CAMPAIGN_SIMULATIONS:
        raise CampaignError(f"Una campagna può avere al massimo {MAX_CAMPAIGN_SIMULATIONS} simulazioni")
    members = []
    for value in values:
        for seed in seeds:
            member = copy.deepcopy(params)
            _set(member, seed_path(params), seed)
            if sweep:
                _set(member, tuple(sweep["path"].split(".")), value)
            member["save_spikes"] = save_spikes
            members.append((seed, value, member))
    return members


def summarise_group(entries: list, reference: dict | None = None) -> dict:
    """Mette insieme i tempi di risposta della stessa popolazione in più simulazioni.
    `entries` è una lista di (id simulazione, seed, voce di race_model.json)."""
    # Per condizione, i tempi di ogni simulazione: gli intervalli di confidenza ricampionano
    # le simulazioni prima dei trial.
    by_simulation = {label: [] for label in CONDITIONS}
    trials = {"V": 0, "A": 0, "AV": 0}
    per_simulation = []
    for simulation_id, seed, entry in entries:
        times = entry.get("reaction_times_ms") or {}
        for label in CONDITIONS:
            by_simulation[label].append(times.get(label) or [])
        for label in trials:
            trials[label] += int((entry.get("trials") or {}).get(label) or 0)
        per_simulation.append({
            "simulation_id": simulation_id,
            "seed": seed,
            "median_ms": {label: median_or_none(times[label]) for label in CONDITIONS if label in times},
        })

    pooled = {label: [value for times in groups for value in times] for label, groups in by_simulation.items()}
    conditions = []
    for label in CONDITIONS:
        values = pooled[label]
        if label == "race" and not values:
            continue
        row = {
            "label": label,
            "trials": trials.get(label),
            "responses": len(values),
            "median_ms": median_or_none(values),
            "ci95_ms": median_ci(by_simulation[label]),
            "percentiles_ms": percentiles(values),
        }
        reference_values = (reference or {}).get(label)
        if reference_values:
            row["reference"] = {
                "responses": len(reference_values),
                "median_ms": median_or_none(reference_values),
                "percentiles_ms": percentiles(reference_values),
                "comparison": median_difference_ci(by_simulation[label], reference_values),
            }
        conditions.append(row)

    rmi = None
    if all(pooled[label] for label in ("V", "A", "AV")):
        result = race_model_inequality(pooled["V"], pooled["A"], pooled["AV"], trials["V"], trials["A"], trials["AV"])
        rmi = {"max_violation": round(result["max_violation"], 4), "p_value": result["p_value"], "significant": result["significant"]}

    faster = None
    if pooled["AV"] and pooled["race"]:
        faster = sum(av < race for av, race in zip(percentiles(pooled["AV"]), percentiles(pooled["race"])))

    first = entries[0][2]
    return {
        "population": first.get("population"),
        "note": first.get("note"),
        "method": first.get("method"),
        "simulations": len(entries),
        "conditions": conditions,
        "percentile_levels": list(PAPER_PERCENTILES),
        "percentiles_av_faster_than_race": faster,
        "rmi": rmi,
        "per_simulation": per_simulation,
    }


def summarise(members: list, reference: dict | None = None) -> list:
    """Riepilogo per valore del parametro variabile. `members` è una lista di
    (id simulazione, seed, valore, voci di race_model.json di quella simulazione)."""
    points = {}
    for simulation_id, seed, value, entries in members:
        groups = points.setdefault(value, {})
        for entry in entries:
            groups.setdefault(entry.get("population"), []).append((simulation_id, seed, entry))
    return [
        {"value": value, "groups": [summarise_group(entries, reference) for entries in groups.values()]}
        for value, groups in points.items()
    ]


def delete_campaign_rows(db, campaign: Campaign) -> None:
    """Elimina la campagna con le sue simulazioni e i loro risultati (senza commit)."""
    for simulation in db.query(Simulation).filter(Simulation.campaign_id == campaign.id).all():
        if simulation.results_path:
            storage.delete_tree(simulation.results_path)
        db.delete(simulation)
    db.flush()
    db.delete(campaign)
