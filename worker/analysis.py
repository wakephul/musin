"""Analisi degli spike: solo numpy, nessuna dipendenza da NEST (testabile da sola)."""
import numpy as np

TIME_DECIMALS = 6
# Soglia del test sulla Race Model Inequality.
RMI_ALPHA = 0.05
RMI_MIN_TRIALS = 10


def snap(value: float, resolution: float) -> float:
    """Arrotonda un tempo alla griglia del kernel (NEST accetta solo multipli della risoluzione)."""
    return round(round(value / resolution) * resolution, TIME_DECIMALS)


def poisson_trains(rng, rate_hz: float, n_sources: int, t_start: float, t_end: float, resolution: float = 0.1) -> list:
    """Treni di Poisson indipendenti in (t_start, t_end], sulla griglia, senza tempi ripetuti."""
    duration = t_end - t_start
    if rate_hz <= 0 or duration <= 0 or n_sources <= 0:
        return [[] for _ in range(max(n_sources, 0))]
    first_step = round(t_start / resolution)
    trains = []
    for count in rng.poisson(rate_hz * duration / 1000.0, size=n_sources):
        steps = np.unique(np.round((t_start + rng.uniform(0.0, duration, size=count)) / resolution).astype(np.int64))
        steps = steps[steps > first_step]
        trains.append(np.round(steps * resolution, TIME_DECIMALS).tolist())
    return trains


def binned_rate(times, n_neurons: int, bin_ms: float, total_ms: float):
    """Frequenza media per neurone (Hz) in bin consecutivi. Restituisce (inizio dei bin, frequenze)."""
    edges = np.arange(0.0, total_ms + bin_ms, bin_ms)
    counts, _ = np.histogram(np.asarray(times, dtype=float), bins=edges)
    return edges[:-1], counts * 1000.0 / (bin_ms * max(int(n_neurons), 1))


def trailing_mean(values, window: int):
    """Media mobile causale: il bin i media i bin i-window+1..i. Una finestra centrata
    farebbe comparire il superamento di soglia prima degli spike che lo causano."""
    window = max(int(window), 1)
    return np.convolve(np.asarray(values, dtype=float), np.ones(window) / window, mode="full")[: len(values)]


def first_crossing(bin_starts, values, threshold: float, t_from: float, t_to: float):
    """Inizio del primo bin in [t_from, t_to) in cui `values` raggiunge la soglia, o None."""
    bin_starts = np.asarray(bin_starts)
    window = (bin_starts >= t_from) & (bin_starts < t_to)
    hits = np.flatnonzero(np.asarray(values)[window] >= threshold)
    return float(bin_starts[window][hits[0]]) if len(hits) else None


def first_upward_crossing(bin_starts, values, threshold: float, t_from: float, t_to: float):
    """Come first_crossing, ma il bin precedente deve essere sotto soglia: un'attività
    già sopra soglia all'inizio della finestra (residuo del trial prima) non è una risposta."""
    bin_starts, values = np.asarray(bin_starts), np.asarray(values)
    indices = np.flatnonzero((bin_starts >= t_from) & (bin_starts < t_to))
    for index in indices:
        if values[index] >= threshold and (index == 0 or values[index - 1] < threshold):
            return float(bin_starts[index])
    return None


def ecdf(samples, grid, n_trials: int):
    """Frazione dei trial con risposta entro ogni tempo della griglia. Il denominatore è
    il numero di trial, non di risposte: un trial senza risposta non arriva mai a 1."""
    samples = np.sort(np.asarray(samples, dtype=float))
    return np.searchsorted(samples, np.asarray(grid, dtype=float), side="right") / max(int(n_trials), 1)


def _violation(rt_v, rt_a, rt_av, n_v: int, n_a: int, n_av: int, grid):
    cdf_v, cdf_a, cdf_av = ecdf(rt_v, grid, n_v), ecdf(rt_a, grid, n_a), ecdf(rt_av, grid, n_av)
    bound = np.minimum(cdf_v + cdf_a, 1.0)
    return cdf_v, cdf_a, cdf_av, bound


def race_model_inequality(rt_v, rt_a, rt_av, n_v: int, n_a: int, n_av: int, step_ms: float = 1.0,
                          n_bootstrap: int = 2000, seed: int = 0) -> dict:
    """Disuguaglianza del race model (Miller 1982): F_AV(t) <= F_V(t) + F_A(t).

    Vale anche con i trial mancati, purché le F siano calcolate su tutti i trial
    (è la disuguaglianza di Boole); per questo servono i conteggi n_*.

    La violazione massima da sola non dice nulla: con pochi trial le distribuzioni
    empiriche superano il limite per caso. `p_value` è la probabilità di una violazione
    almeno così grande quando la disuguaglianza vale, stimata con un bootstrap nel caso
    meno favorevole (risposte AV distribuite esattamente come il limite V + A).
    Sotto RMI_MIN_TRIALS trial per condizione il ricampionamento non ha abbastanza
    valori da cui pescare e il test non viene fatto (`p_value` None).
    """
    rt_v, rt_a, rt_av = (np.sort(np.asarray(x, dtype=float)) for x in (rt_v, rt_a, rt_av))
    all_rts = np.concatenate([rt_v, rt_a, rt_av])
    grid = np.arange(0.0, (all_rts.max() if len(all_rts) else 0.0) + step_ms, step_ms)
    cdf_v, cdf_a, cdf_av, bound = _violation(rt_v, rt_a, rt_av, n_v, n_a, n_av, grid)
    violation = cdf_av - bound
    max_violation = float(violation.max()) if len(violation) else 0.0

    p_value = None
    if len(rt_v) and len(rt_a) and len(rt_av) and min(n_v, n_a, n_av) >= RMI_MIN_TRIALS and n_bootstrap > 0:
        rng = np.random.default_rng(seed)
        # Quantili del limite min(1, F_V + F_A): il tempo in cui il limite raggiunge u.
        support = np.unique(np.concatenate([rt_v, rt_a]))
        bound_at_support = np.minimum(ecdf(rt_v, support, n_v) + ecdf(rt_a, support, n_a), 1.0)
        # Un trial unimodale senza risposta resta senza risposta anche nel ricampionamento.
        v_all = np.concatenate([rt_v, np.full(n_v - len(rt_v), np.inf)])
        a_all = np.concatenate([rt_a, np.full(n_a - len(rt_a), np.inf)])
        exceed = 0
        for _ in range(n_bootstrap):
            v_star = rng.choice(v_all, size=n_v)
            a_star = rng.choice(a_all, size=n_a)
            index = np.searchsorted(bound_at_support, rng.uniform(size=n_av), side="left")
            av_star = support[index[index < len(support)]]   # oltre il massimo del limite: nessuna risposta
            _, _, star_av, star_bound = _violation(v_star[np.isfinite(v_star)], a_star[np.isfinite(a_star)],
                                                   av_star, n_v, n_a, n_av, grid)
            exceed += float((star_av - star_bound).max()) >= max_violation
        p_value = (exceed + 1) / (n_bootstrap + 1)

    return {
        "time_ms": grid,
        "cdf_v": cdf_v,
        "cdf_a": cdf_a,
        "cdf_av": cdf_av,
        "bound": bound,
        "violation": violation,
        "max_violation": max_violation,
        "p_value": p_value,
        "significant": p_value is not None and p_value < RMI_ALPHA,
    }


# Percentili a cui Cavadini et al. (2025) e Ronconi et al. (2017) riportano le distribuzioni.
PAPER_PERCENTILES = tuple(range(5, 100, 10))


def percentiles(samples, points=PAPER_PERCENTILES) -> list:
    """Tempi di risposta ai percentili dati; lista vuota senza campioni."""
    if not len(samples):
        return []
    return [round(float(value), 1) for value in np.percentile(np.asarray(samples, dtype=float), points)]


def paired_race(rt_first, rt_second) -> list:
    """Modello a gara del paper: per ogni coppia di trial risponde il canale più veloce.
    `None` è un trial senza risposta; la coppia manca solo se mancano entrambi."""
    race = []
    for first, second in zip(rt_first, rt_second):
        answered = [rt for rt in (first, second) if rt is not None]
        if answered:
            race.append(min(answered))
    return race


def decide(spikes_a: int, spikes_b: int, pop_a: str, pop_b: str, margin: float = 0.0) -> str:
    """Popolazione vincente per numero di spike, 'none' se la differenza non supera il margine."""
    net = spikes_a - spikes_b
    if net > margin:
        return pop_a
    if net < -margin:
        return pop_b
    return "none"


def cf_gated_ltd(weights, depress, ltd: float, ltp: float, w_min: float, w_max: float):
    """Plasticità PF→PC dopo un trial di addestramento. `depress` segna le sinapsi con
    fibra parallela attiva verso una Purkinje che ha ricevuto la fibra rampicante:
    quelle perdono `ltd`, le altre recuperano lentamente `ltp`."""
    weights = np.asarray(weights, dtype=float)
    return np.where(depress, np.maximum(w_min, weights - ltd), np.minimum(w_max, weights + ltp))


def median_or_none(values):
    return round(float(np.median(values)), 1) if len(values) else None
