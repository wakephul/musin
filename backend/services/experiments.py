"""Regole comuni ad API e worker sui parametri di un esperimento: tipo, valori di
default che determinano la durata, limiti."""
import math

BUILTIN_EXPERIMENTS = ("cerebellum_msi_race", "cerebellum_conditioning", "decision_making")
CONDITIONING_TRIAL_MS = 3000.0

# Default letti sia qui (stima della durata) sia dagli esperimenti del worker.
# 15 trial di addestramento: i 45 s con trial da 3 s del modello originale.
CONDITIONING_DEFAULTS = {"n_train": 15, "n_test": 30}
DECISION_DEFAULTS = {"modality": "dual", "num_trials": 12, "trial_slot_ms": 3000.0}
MSI_TRAIN_DEFAULTS = {"n_trials": 45, "trial_duration_ms": 1000.0, "iti_range_ms": [500, 1000]}
MSI_TEST_DEFAULTS = {"n_trials": 100, "trial_duration_ms": 1000.0, "iti_range_ms": [200, 400]}

# Tetti che tengono memoria e tempi del worker entro limiti ragionevoli.
MAX_TRIALS = 10_000
MAX_SOURCES = 10_000          # afferenze o generatori di un dispositivo
MAX_NETWORK_ORDER = 2_000     # scala della rete di decisione
MAX_GRANULE_CELLS = 200_000
MAX_PURKINJE_CELLS = 10_000


class ExperimentParamsError(ValueError):
    pass


def experiment_kind(params: dict) -> str:
    builtin = params.get("builtin")
    if builtin in BUILTIN_EXPERIMENTS:
        return builtin
    return "trial_protocol" if params.get("protocol") else "continuous"


def _section(params: dict, key: str) -> dict:
    value = params.get(key) or {}
    if not isinstance(value, dict):
        raise ExperimentParamsError(f"'{key}' deve essere un oggetto JSON")
    return value


def _number(section: dict, key: str, default, *, minimum: float = 0.0, maximum: float = math.inf, name: str | None = None) -> float:
    """Valore numerico finito in [minimum, maximum]; il nome nell'errore è quello del parametro."""
    name = name or key
    value = section.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ExperimentParamsError(f"'{name}' deve essere un numero")
    if not minimum <= value <= maximum:
        limit = f"tra {minimum:g} e {maximum:g}" if math.isfinite(maximum) else f"almeno {minimum:g}"
        raise ExperimentParamsError(f"'{name}' deve essere {limit}")
    return float(value)


def _count(section: dict, key: str, default, *, minimum: int = 1, maximum: int = MAX_TRIALS, name: str | None = None) -> int:
    value = _number(section, key, default, minimum=minimum, maximum=maximum, name=name)
    if value != int(value):
        raise ExperimentParamsError(f"'{name or key}' deve essere un numero intero")
    return int(value)


def _iti_upper(section: dict, default, name: str) -> float:
    iti_range = section.get("iti_range_ms") or default
    if not isinstance(iti_range, (list, tuple)) or len(iti_range) != 2:
        raise ExperimentParamsError(f"'{name}' deve essere una coppia [minimo, massimo]")
    low, high = (_number({"v": bound}, "v", None, name=name) for bound in iti_range)
    if low > high:
        raise ExperimentParamsError(f"'{name}': il minimo supera il massimo")
    return high


def _check_devices(params: dict) -> None:
    inputs = _section(params, "inputs")
    for device in inputs.get("devices") or []:
        device_params = device.get("params") or {} if isinstance(device, dict) else None
        if not isinstance(device_params, dict):
            raise ExperimentParamsError("I parametri di un dispositivo devono essere un oggetto JSON")
        _count(device_params, "n_sources", 1, maximum=MAX_SOURCES, name="n_sources")
        _count(device, "size", 1, maximum=MAX_SOURCES, name="size")


def estimate_duration_ms(params: dict) -> float:
    """Controlla i parametri che fissano dimensioni e durata e restituisce il tempo biologico
    totale in ms. Solleva ExperimentParamsError con un messaggio leggibile se non sono validi.

    Con ITI casuale la durata è una stima per eccesso: il worker ricalcola la timeline esatta.
    """
    kind = experiment_kind(params)
    if params.get("builtin") and kind != params["builtin"]:
        raise ExperimentParamsError(f"Esperimento built-in sconosciuto: {params['builtin']}")

    if kind == "decision_making":
        dm = _section(params, "decision_making")
        _count(dm, "order", 400, maximum=MAX_NETWORK_ORDER, name="order")
        _count(dm, "number_of_neurons", 80, maximum=MAX_SOURCES, name="number_of_neurons")
        # Con "dual" si simulano due reti, una dopo l'altra, sugli stessi trial.
        networks = 2 if dm.get("modality", DECISION_DEFAULTS["modality"]) == "dual" else 1
        trials = _count(dm, "num_trials", DECISION_DEFAULTS["num_trials"])
        return networks * trials * _number(dm, "trial_slot_ms", DECISION_DEFAULTS["trial_slot_ms"], minimum=1.0)

    if kind == "cerebellum_conditioning":
        _count(params, "GR_num", 2000, minimum=10, maximum=MAX_GRANULE_CELLS)
        _count(params, "PC_num", 100, minimum=4, maximum=MAX_PURKINJE_CELLS)
        n_train = _count(params, "n_train", CONDITIONING_DEFAULTS["n_train"], minimum=0)
        n_test = _count(params, "n_test", CONDITIONING_DEFAULTS["n_test"])
        return (n_train + 3 * n_test) * CONDITIONING_TRIAL_MS

    if kind == "cerebellum_msi_race":
        total = 0.0
        for section_name, defaults in (("train", MSI_TRAIN_DEFAULTS), ("test", MSI_TEST_DEFAULTS)):
            section = _section(params, section_name)
            trials = _count(section, "n_trials", defaults["n_trials"], minimum=0, name=f"{section_name}.n_trials")
            trial_ms = _number(section, "trial_duration_ms", defaults["trial_duration_ms"], minimum=1.0, name=f"{section_name}.trial_duration_ms")
            _number(section, "stimulus_duration_ms", trial_ms, maximum=trial_ms, name=f"{section_name}.stimulus_duration_ms")
            _count(section, "n_sources", 20, maximum=MAX_SOURCES, name=f"{section_name}.n_sources")
            _count(section, "us_n_sources", 10, maximum=MAX_SOURCES, name=f"{section_name}.us_n_sources")
            total += trials * (trial_ms + _iti_upper(section, defaults["iti_range_ms"], f"{section_name}.iti_range_ms"))
        return total

    _check_devices(params)
    if kind == "trial_protocol":
        protocol = _section(params, "protocol")
        trials = _count(protocol, "num_trials", 1)
        trial_ms = _number(protocol, "trial_duration_ms", 1000.0, minimum=1.0)
        _number(protocol, "stimulus_duration_ms", trial_ms, maximum=trial_ms)
        iti = _iti_upper(protocol, None, "iti_range_ms") if protocol.get("iti_range_ms") else _number(protocol, "iti_ms", 0.0)
        return trials * (trial_ms + iti)

    phases = _section(params, "phases")
    return _number(phases, "train_duration_ms", 0.0) + _number(phases, "test_duration_ms", 0.0)
