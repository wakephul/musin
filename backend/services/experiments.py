"""Regole comuni ad API e worker sui parametri di un esperimento."""

BUILTIN_EXPERIMENTS = ("cerebellum_msi_race", "cerebellum_conditioning", "decision_making")
CONDITIONING_TRIAL_MS = 3000.0


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


def estimate_duration_ms(params: dict) -> float:
    """Tempo biologico totale della simulazione. Solleva ExperimentParamsError sui parametri non validi.

    Per gli esperimenti con ITI casuale è una stima per eccesso: il worker ricalcola
    la timeline esatta.
    """
    try:
        kind = experiment_kind(params)
        if params.get("builtin") and kind != params["builtin"]:
            raise ExperimentParamsError(f"Esperimento built-in sconosciuto: {params['builtin']}")

        if kind == "decision_making":
            dm = _section(params, "decision_making")
            return float(dm.get("trial_slot_ms", 3000.0)) * int(dm.get("num_trials", 12))

        if kind == "cerebellum_conditioning":
            n_trials = int(params.get("n_train", 20)) + 3 * int(params.get("n_test", 20))
            return n_trials * CONDITIONING_TRIAL_MS

        if kind == "cerebellum_msi_race":
            train, test = _section(params, "train"), _section(params, "test")
            train_iti = train.get("iti_range_ms") or [500, 1000]
            test_iti = test.get("iti_range_ms") or [1000, 2500]
            return (
                int(train.get("n_trials", 50)) * (float(train.get("trial_duration_ms", 1000.0)) + float(train_iti[1]))
                + int(test.get("n_trials", 100)) * (float(test.get("trial_duration_ms", 1500.0)) + float(test_iti[1]))
            )

        if kind == "trial_protocol":
            protocol = _section(params, "protocol")
            iti_range = protocol.get("iti_range_ms")
            iti = float(iti_range[1]) if iti_range else float(protocol.get("iti_ms", 0.0))
            return int(protocol.get("num_trials", 1)) * (float(protocol.get("trial_duration_ms", 1000.0)) + iti)

        phases = _section(params, "phases")
        return float(phases.get("train_duration_ms", 0.0)) + float(phases.get("test_duration_ms", 0.0))
    except ExperimentParamsError:
        raise
    except (TypeError, ValueError, IndexError) as exc:
        raise ExperimentParamsError(f"Parametri dell'esperimento non validi: {exc}") from exc
