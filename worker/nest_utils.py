"""Operazioni NEST condivise dagli esperimenti."""
import logging

logger = logging.getLogger(__name__)

NUM_THREADS = 6
MAX_RECORDED_NEURONS = 250

# I modelli NESTML di CerebNEST non espongono tutti i parametri in GetDefaults():
# per loro i parametri passano senza filtro.
CEREBNEST_MODELS = {
    "eglif_cond_alpha_multisyn",
    "eglif_pc_nestml",
    "eglif_mli",
    "eglif_io_nestml",
    "eglif_dcnp",
}
CONNECTION_KEYS = {"indegree", "outdegree", "p", "allow_autapses", "allow_multapses"}
INTEGER_CONNECTION_KEYS = {"indegree", "outdegree"}


def init_kernel(nest, resolution: float, seed: int) -> None:
    nest.ResetKernel()
    nest.SetKernelStatus({
        "local_num_threads": NUM_THREADS,
        "resolution": resolution,
        "rng_seed": seed,
        "dict_miss_is_error": False,
        "print_time": False,
    })
    # Il modulo si chiama in modo diverso a seconda della build di CerebNEST;
    # ResetKernel lo lascia caricato, quindi dal secondo task Install fallisce.
    for module_name in ("cerebmodule", "cerebellar_module"):
        try:
            nest.Install(module_name)
            break
        except Exception:
            continue


def is_stimulus_model(model: str) -> bool:
    return "generator" in model or "stimulus" in model


def sanitize_params(nest, params: dict) -> dict:
    """Converte {"distribution": ...} in parametri casuali NEST e gli interi in float."""
    sanitized = {}
    for key, value in params.items():
        if isinstance(value, dict) and "distribution" in value:
            if value["distribution"] == "uniform":
                sanitized[key] = nest.random.uniform(min=float(value.get("low", 0.0)), max=float(value.get("high", 1.0)))
            elif value["distribution"] == "normal":
                sanitized[key] = nest.random.normal(mean=float(value.get("mean", 0.0)), std=float(value.get("std", 1.0)))
            else:
                raise ValueError(f"Distribuzione non supportata per '{key}': {value['distribution']}")
        elif isinstance(value, int) and not isinstance(value, bool) and key not in CONNECTION_KEYS and key != "receptor_type":
            sanitized[key] = float(value)
        else:
            sanitized[key] = value
    return sanitized


def create_population(nest, model: str, size: int, params: dict):
    params = sanitize_params(nest, params or {})
    if model not in CEREBNEST_MODELS:
        known = nest.GetDefaults(model).keys()
        ignored = sorted(key for key in params if key not in known)
        if ignored:
            logger.warning("Parametri ignorati da %s: %s", model, ", ".join(ignored))
        params = {key: value for key, value in params.items() if key in known}
    return nest.Create(model, int(size), params=params)


def record_spikes(nest, nodes):
    """spike_recorder sui primi MAX_RECORDED_NEURONS neuroni. Restituisce (recorder, n registrati)."""
    recorded = nodes[:min(len(nodes), MAX_RECORDED_NEURONS)]  # NodeCollection non accetta slice oltre la fine
    recorder = nest.Create("spike_recorder")
    nest.Connect(recorded, recorder)
    return recorder, len(recorded)


def spike_events(recorder) -> dict:
    events = recorder.get("events")
    return {"senders": events["senders"].tolist(), "times": events["times"].tolist()}


def connect(nest, source, target, rule: str, params: dict, synapse_model: str = "static_synapse") -> None:
    """nest.Connect da una proiezione {rule, params}: i parametri della regola
    (indegree, outdegree, p) stanno in `params` insieme a quelli della sinapsi."""
    syn_spec = sanitize_params(nest, params or {})
    conn_spec = {"rule": rule}
    for key in CONNECTION_KEYS & syn_spec.keys():
        value = syn_spec.pop(key)
        conn_spec[key] = int(float(value)) if key in INTEGER_CONNECTION_KEYS else value
    syn_spec["synapse_model"] = synapse_model

    receptors = set(nest.GetDefaults(target[0].get("model")).get("receptor_types", {}).values())
    if receptors:
        if "receptor_type" not in syn_spec:
            syn_spec["receptor_type"] = min(receptors)
        elif int(syn_spec["receptor_type"]) not in receptors:
            raise ValueError(
                f"receptor_type {syn_spec['receptor_type']} non esiste nel modello di destinazione "
                f"(disponibili: {sorted(receptors)})"
            )
    elif "receptor_type" in syn_spec and target[0].get("model") not in CEREBNEST_MODELS:
        # Modelli con una sola porta (es. iaf_cond_exp): il segno del peso sceglie la conduttanza.
        del syn_spec["receptor_type"]
    nest.Connect(source, target, conn_spec=conn_spec, syn_spec=syn_spec)


def set_spike_trains(nest, trains: list):
    """Uno spike_generator per treno."""
    generators = nest.Create("spike_generator", len(trains))
    for generator, train in zip(generators, trains):
        if train:
            generator.set(spike_times=train)
    return generators
