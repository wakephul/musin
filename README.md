# MuSiN — Multiple Simulations on NEST

MuSiN is a web application for building spiking neural networks, running them on
the **NEST** simulator (3.8) and inspecting the results. A network is drawn in a
visual editor, a simulation is configured from a form, a Celery worker runs it,
and plots and metrics come back to the browser.

It was built to study the **cerebellar contribution to audiovisual multisensory
integration** _in silico_, tested with the Race Model Inequality (Miller 1982).
The computational model is described in:

> Cavadini, Riccardo, et al. _"Cerebellar contribution to multisensory integration:
> A computational modeling exploration."_ APL Bioengineering 9.2 (2025).

which replicates the clinical findings of:

> Ronconi, Luca, et al. _"When one is enough: Impaired multisensory integration in
> cerebellar agenesis."_ Cerebral Cortex 27.3 (2017): 2041–2051.

## Quick start

Requirements: Docker Engine 24+ with Compose v2, 8 GB of RAM for Docker (16 GB for
the full-size networks).

```bash
cp .env.example .env        # then replace every change_me value
docker compose up --build -d
```

The first build compiles NEST and CerebNEST from source and takes about ten minutes.

| What             | Where                      |
| ---------------- | -------------------------- |
| Web app          | http://localhost:3000      |
| API docs         | http://localhost:8010/docs |

Both answer on this machine only. To reach the web app from other machines set
`MUSIN_BIND=0.0.0.0` in `.env` (see [Configuration](#configuration) first).

Sign in with `FIRST_SUPERUSER_EMAIL` / `FIRST_SUPERUSER_PASSWORD` from your `.env`,
or create an account from the sign-in page (`ALLOW_REGISTRATION=false` turns that off).

## Using it

1. **Build a network** (_Nuova rete_). Add populations (id, size, NEST model,
   parameters) and projections (rule, synapse model, weight, delay). A negative weight
   is inhibitory. _Parti da un modello_ loads the cerebellar microcircuit used by the
   multisensory experiment.
2. **Launch a simulation** from the network row (_Simula_). Three modes:
   - **Esperimento predefinito**: one of the three experiments described below. Two of
     them are the models compared in the paper.
   - **Protocollo a trial**: your network, stimulus devices switched on per trial
     according to a pool of conditions, with decision accuracy, response-time CDFs
     and an optional Race Model Inequality.
   - **Simulazione continua**: your network with stimuli always on, optionally split
     into a training and a test phase.
3. **Watch and read the results** on the simulation page: progress, _Interrompi_,
   then plots, metrics and downloads (`graphs.zip`, `spikes.json`).
4. **Repeat it as a campaign.** With _Ripetizioni_ above 1 the same launch runs with
   consecutive seeds, and _Parametro da variare_ repeats it for each value of one
   parameter. See [Campaigns](#campaigns).
5. **Stimuli** (_Stimoli_): upload recorded spike trains (JSON, CSV or HDF5, times in
   ms) and replay them through a "Treni di spike da file" device.

## The experiments

The two cerebellar experiments use `iaf_cond_exp` neurons with the parameters of the
original NEST 2.18 model, so populations are silent without input and a reaction time
can be read as a firing-rate threshold crossing. The decision network uses
`iaf_psc_exp_multisynapse` with noise, AMPA, NMDA and GABA receptors.

| Paper (Fig. 9)                                    | Experiment here                               |
| ------------------------------------------------- | --------------------------------------------- |
| Control model: cerebellar network                 | `cerebellum_conditioning`                     |
| Acerebellar model: two cortical networks, a race  | `decision_making` with `modality: "dual"`     |

`cerebellum_msi_race` is not in the paper: it asks the same question (does the
audiovisual response beat the race model?) on a network drawn in the editor.

Every experiment with unimodal and audiovisual trials reports the Race Model Inequality
`F_AV(t) ≤ F_V(t) + F_A(t)` over all trials, so missed trials count. The largest
violation alone means little with few trials, so it comes with a p-value: a bootstrap
of the least favourable case in which the inequality still holds. Facilitation is
reported when p < 0.05, and not tested with fewer than 10 trials per condition.

### Audiovisual multisensory integration — `cerebellum_msi_race`

Runs on **your network**, which must contain `GR`, `PC_A`, `PC_B`, `IO_A`, `DCN_A`
and `DCN_B` (the microcircuit template has them).

- **Training.** Each trial presents a visual or an auditory Poisson stimulus to the
  granule cells together with a teaching signal on `IO_A`. After the trial, `GR→PC_A`
  synapses of the granule cells that fired are depressed, but only if `IO_A` fired
  in that trial (climbing-fibre-gated LTD). NEST 3.8 has no CerebNEST volume
  transmitter, so the rule is applied between trials. `PC_A` stops responding and
  stops inhibiting `DCN_A`. Without the teaching signal nothing is learned and the
  test finds no responses.
- **Test** (plasticity off). V, A, AV and catch trials (30/30/30/10 %). In AV the two
  stimuli stay independent and their conductances add on `DCN_A`. Latencies: auditory
  180 ms, visual 220 ms.
- **Readout.** Reaction time is the first moment a DCN population exceeds its
  pre-stimulus baseline by `threshold_delta_hz`. Reported: hits, misses, false alarms
  and correct rejections; reaction-time CDFs per condition; the Race Model Inequality.

With the default parameters the median reaction time is about 245 ms for AV against
about 310 ms for either single modality, and the inequality is violated.

### Associative conditioning — `cerebellum_conditioning`

The control model of the paper. Builds its **own network** (2000 GR, 100 PC, 100 IO,
50 DCN on two sides A/B); the selected network is not simulated. Training pairs an
auditory or visual stimulus on one side with the teaching signal of that side and
applies the same climbing-fibre-gated LTD. The test presents auditory, visual and
audiovisual trials (latencies 150 and 220 ms, as in the original configuration) and
reports, per condition, how often the DCN of the stimulated side wins, how often the
other side wins, and how often nothing responds. The defaults are 15 training trials,
the 45 s of the original protocol, and 30 test trials per condition.

The response time is the first moment the two DCN rates differ by 15 Hz (5 ms bins,
5-bin running mean). The audiovisual responses are compared with the race model, the
faster of the auditory and visual response of each trial pair, at the percentiles 5
to 95 used in Fig. 9.

### Audiovisual decision — `decision_making`

The acerebellar model of the paper. Builds its **own network**: a two-population
attractor (Wang) with a shared inhibitory pool. Each trial stimulates one side; the
response is the first population whose rate rises above threshold. Trials are 3 s
long because the attractor keeps firing for up to a second after the stimulus.

With `modality: "dual"` (the default) two independent networks run, one per modality,
on the same trial sequence; the audiovisual response is the faster of the two, so
nothing is integrated and the inequality cannot be violated. `auditory`, `visual` and
`audiovisual` run a single network. The background noise rate is drawn once per
simulation, as in the original model, and the network sits close to threshold: the
median response time moves by tens of milliseconds from one seed to the next.

## Campaigns

One simulation of the cerebellar network with 45 trials per condition leaves the median
response time uncertain by about ±40 ms. A campaign runs the same experiment with
several seeds and pools the response times, and can also vary one numeric parameter over
a list of values: every value is simulated with every seed, up to 50 simulations in all.
The simulator still runs them one at a time.

The campaign page shows, for each value of the parameter:

- trials, responses and median response time per condition, with a 95 % confidence
  interval obtained by resampling;
- the Race Model Inequality tested on all the trials together;
- the response times at the percentiles 5 to 95, as a plot;
- the medians of each simulation, to see how much they move from seed to seed.

**Reference data.** _Confronta con_ puts a set of measured response times next to the
simulated ones: its median, the difference between the two medians with a confidence
interval, and its percentiles on the plot. The response times behind Fig. 9 of the
paper are included, one set for the cerebellar network and one for the cortical ones.
Other sets can be uploaded as a CSV with two columns, condition (`A`, `V`, `AV`, `race`)
and response time in ms.

A campaign summarises experiments that report V, A and AV response times: the three
predefined ones (the decision network only with two networks) and a trial protocol with
the Race Model Inequality switched on. For the others it is a way to launch the
repetitions together; the results stay in the single simulations.

Campaign simulations do not save `spikes.json` unless asked: two cortical networks
produce about 200 MB of spikes per simulation.

### How close this is to the paper

Median response times in ms, three seeds pooled; in brackets the 95 % bootstrap
interval. Parameters are the defaults except the number of trials: 45 test trials per
condition for the cerebellar network, 40 trials for the cortical ones. The paper
column is the response times behind Fig. 9, read from the notebooks of the original
analysis.

| Cerebellar network (135 trials per condition) | Here            | Paper (541) |
| --------------------------------------------- | --------------- | ----------- |
| Auditory                                      | 328 (305 – 372) | 320         |
| Visual                                        | 390 (355 – 415) | 370         |
| Audiovisual                                   | 245 (240 – 245) | 245         |
| Race model                                    | 322 (308 – 340) | 305         |

Audiovisual responses are faster than the race model at 10 of the 10 percentiles (8 of
10 in the paper data) and the inequality is violated in every run (p < 0.001).

| Two cortical networks (120 trials) | Here            | Paper (40) |
| ---------------------------------- | --------------- | ---------- |
| Auditory                           | 240 (218 – 260) | 290        |
| Visual                             | 320 (310 – 342) | 335        |
| Audiovisual = race                 | 230 (218 – 255) | 275        |

The cortical auditory network answers earlier here than in the paper's single set of
40 trials. Its median depends on the noise draw: 228 to 265 ms across the three seeds,
and about 20 ms more in a fourth run with a lower background rate (0.9 instead of
4.4 Hz). The paper's 290 ms sits at the upper edge of that range. The qualitative
result holds in every run: no violation without the cerebellum, a violation with it.

## Architecture

| Service    | Tech                                 | Host port                    |
| ---------- | ------------------------------------ | ---------------------------- |
| `frontend` | Angular 18, Tailwind, Cytoscape.js   | 3000 (nginx, proxies `/api`) |
| `api`      | FastAPI, SQLAlchemy 2, Alembic       | 8010 (localhost only)        |
| `worker`   | Celery + PyNEST 3.8 + CerebNEST      | none                         |
| `db`       | MySQL 8.4                            | 3307 (localhost only)        |
| `redis`    | Redis 7 (queue and task state)       | 6380 (localhost only)        |

Plots, metrics, spike files and uploaded stimuli are plain files in the Docker volume
`musin_storage`, mounted at `/data` in both `api` and `worker`. The browser downloads
them from the API through signed links that expire after one hour.

```
backend/            FastAPI app
  api/routers/      auth, networks, simulations, campaigns, references, stimuli,
                    files (signed downloads)
  core/             settings, database session, security, NEST model catalogue
  data/             reference response times from the paper
  migrations/       Alembic revisions, applied at startup
  services/         file storage, experiment rules, launching, campaign summary,
                    stimulus and reference file parsers
  tests/
worker/
  tasks.py          Celery task: picks the experiment, tracks status and abort
  networks/         generic (user networks), cerebellum_msi_race,
                    cerebellum_conditioning, decision_making
  analysis.py       spike analysis (numpy only)
  nest_utils.py     shared NEST helpers
  results.py        writes artefacts to the storage and to graphs.zip
  tests/
frontend/           Angular app
infrastructure/     engine Dockerfile, nginx config
```

The worker runs one simulation at a time (Celery `solo` pool); others wait in the
queue. _Interrompi_ is cooperative: the worker re-reads the simulation status at
every progress update and stops within a few seconds.

Simulations are reproducible: the `seed` parameter drives both NEST and the stimulus
generation.

## API

Base path `/api/v1`, reachable through the web app (`http://localhost:3000/api/v1`)
or directly on `http://localhost:8010` from the same machine. Interactive docs:
`http://localhost:8010/docs`. Every route except login, register and config needs
`Authorization: Bearer <token>`.

| Prefix         | Routes                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `/auth`        | `POST /login` (form), `POST /register`, `GET /me`, `POST /change-password`, `GET /config`           |
| `/networks`    | `GET`, `POST`, `GET/PUT/DELETE /{id}`, `POST /{id}/fork`, `GET /models` (NEST model catalogue)      |
| `/simulations` | `GET` (paginated), `POST /launch`, `GET /{id}`, `GET /{id}/status`, `POST /{id}/abort`, `GET /{id}/results`, `DELETE /{id}` |
| `/stimuli`     | `GET`, `POST /upload`, `GET /{id}`, `DELETE /{id}`                                                  |
| `/campaigns`   | `GET`, `POST`, `GET/PUT/DELETE /{id}`, `GET /{id}/summary`, `POST /{id}/abort`                      |
| `/references`  | `GET`, `POST` (CSV upload), `DELETE /{id}`                                                          |

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -d "username=$EMAIL" -d "password=$PASSWORD" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
curl -s -X POST http://localhost:3000/api/v1/simulations/launch \
  -H "Authorization: Bearer $TOKEN" \
  -F network_id=1 -F 'params={"builtin": "cerebellum_conditioning", "n_train": 15, "n_test": 45, "seed": 11}'
```

`params` is what the launch form sends. `builtin` selects a predefined experiment;
without it, `protocol` makes a trial protocol and `phases` a continuous simulation.
A trial protocol needs at least one condition in `stimuli_pool`, and each condition
may only name devices listed in `inputs`:

```json
{
  "seed": 5,
  "protocol": {
    "num_trials": 45, "trial_duration_ms": 600, "stimulus_duration_ms": 300, "iti_ms": 200,
    "stimuli_pool": [
      {"devices": ["VIS"], "weight": 1, "condition_label": "V"},
      {"devices": ["AUD"], "weight": 1, "condition_label": "A"},
      {"devices": ["VIS", "AUD"], "weight": 1, "condition_label": "AV"}
    ]
  },
  "inputs": {
    "devices": [
      {"id": "VIS", "model": "poisson_generator", "params": {"rate": 600.0}},
      {"id": "AUD", "model": "poisson_generator", "params": {"rate": 600.0}}
    ],
    "connections": [
      {"source": "VIS", "target": "GR", "rule": "all_to_all", "params": {"weight": 1.0, "delay": 1.0}},
      {"source": "AUD", "target": "GR", "rule": "all_to_all", "params": {"weight": 1.0, "delay": 1.0}}
    ]
  },
  "analysis": {"race_model": {"enabled": true, "populations": ["GR"]}}
}
```

The Race Model Inequality of a trial protocol reads the conditions labelled `V`, `A`
and `AV`. Parameters that are negative, not finite or beyond the size limits are
refused with a 422 and the reason.

A campaign takes the same `params` as JSON, the seeds and, optionally, the parameter
to vary as a dotted path into `params`:

```bash
curl -s -X POST http://localhost:3000/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"network_id": 1, "seeds": [11, 12, 13],
       "params": {"builtin": "cerebellum_conditioning", "n_train": 15, "n_test": 45},
       "sweep": {"path": "aud_latency_ms", "values": [150, 165, 180]}}'
```

## Development

Frontend with live reload, against the API of the running stack:

```bash
cd frontend && npm ci && npm start     # http://localhost:4200, /api proxied to :8010
```

Backend and worker code is mounted into the containers; restart them after a change:

```bash
docker compose restart api worker
```

Tests (no NEST, MySQL or Redis needed):

```bash
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
pytest
```

```bash
cd frontend && npm test                # logic of the editor, launch form and results page
```

Backend tests can also run inside the image, where NEST is installed and
`worker/tests/test_nest_smoke.py` runs each experiment once at a small size:

```bash
docker compose run --rm api sh -c "pip install -q -r backend/requirements-dev.txt && python -m pytest -p no:cacheprovider"
```

Database changes go through Alembic: add a revision in `backend/migrations/versions/`;
it is applied when the API starts.

## Configuration

Everything is in `.env`; `.env.example` documents each variable. For anything that
is not a local machine:

- set `ENVIRONMENT` to something other than `development`: the API then refuses to
  start with the example password for the first user;
- choose real passwords for MySQL and the first user;
- set `MUSIN_BIND=0.0.0.0` only behind HTTPS. There is no login rate limiting.

`SECRET_KEY` can stay empty: a key is generated at the first start and kept in the
data volume (`/data/.secret_key`), so sessions and download links survive restarts.

The simulator uses `WORKER_CPUS` threads (default 6) and at most `WORKER_MEMORY`
(default 20G). Lower both on a smaller machine.

## Known limits

- Versions before October 2026 kept results in MinIO. They are not moved automatically:
  after upgrading, older simulations show no plots until their files are copied into
  the `musin_storage` volume under the same paths (`results/<user>/sim_<id>/…`).
- The CerebNEST EGLIF models are listed in the editor but were not validated here.
  `eglif_dcnp` in particular fires one spike per input spike on receptor 2, whatever
  the weight, so it cannot be inhibited through that port. In the multisensory
  experiment the Purkinje, DCN and inferior-olive EGLIF models are replaced
  (`iaf_cond_exp`, `parrot_neuron`); the granule and interneuron models are not.
- `stdp_synapse_sinexp` needs the CerebNEST volume transmitter, which does not exist
  for NEST 3.8; cerebellar plasticity is therefore applied between trials by the
  experiments themselves and is not available in generic networks.
- Spike recording is capped at the first 250 neurons of each population in user
  networks and in the multisensory experiment. Conditioning records every DCN and
  Purkinje cell; the decision network records every neuron (`rec_pop` lowers that).
- A simulation runs on the network as it was when launched. Simulations launched before
  this was stored (October 2026) read the network's current definition.
- Results computed before the p-value was added show the Race Model Inequality with
  the old criterion (largest violation above 0.05), without a p-value.
- If the simulator restarts while a simulation is running, the simulation is closed as
  failed; it is not resumed.

## Citation

> Cavadini, Riccardo, et al. _"Cerebellar contribution to multisensory integration:
> A computational modeling exploration."_ APL Bioengineering 9.2 (2025).
