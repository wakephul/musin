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
| MinIO console    | http://localhost:9051      |

Sign in with `FIRST_SUPERUSER_EMAIL` / `FIRST_SUPERUSER_PASSWORD` from your `.env`,
or create an account from the sign-in page (`ALLOW_REGISTRATION=false` turns that off).

## Using it

1. **Build a network** (_Nuova rete_). Add populations (id, size, NEST model,
   parameters) and projections (rule, synapse model, weight, delay). A negative weight
   is inhibitory. _Parti da un modello_ loads the cerebellar microcircuit used by the
   multisensory experiment.
2. **Launch a simulation** from the network row (_Simula_). Three modes:
   - **Esperimento predefinito**: one of the three experiments described below.
   - **Protocollo a trial**: your network, stimulus devices switched on per trial
     according to a pool of conditions, with decision accuracy, response-time CDFs
     and an optional Race Model Inequality.
   - **Simulazione continua**: your network with stimuli always on, optionally split
     into a training and a test phase.
3. **Watch and read the results** on the simulation page: progress, _Interrompi_,
   then plots, metrics and downloads (`graphs.zip`, `spikes.json`).
4. **Stimuli** (_Stimoli_): upload recorded spike trains (JSON, CSV or HDF5, times in
   ms) and replay them through a "Treni di spike da file" device.

## The experiments

All three use `iaf_cond_exp` neurons with the parameters of the original NEST 2.18
model, so populations are silent without input and a reaction time can be read as a
firing-rate threshold crossing.

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
  and correct rejections; reaction-time CDFs per condition; the Race Model Inequality
  `F_AV(t) ≤ F_V(t) + F_A(t)`, computed over all trials so missed trials count.

With the default parameters the median reaction time is about 245 ms for AV against
about 310 ms for either single modality, and the inequality is violated.

### Associative conditioning — `cerebellum_conditioning`

Builds its **own network** (2000 GR, 100 PC, 100 IO, 50 DCN on two sides A/B); the
selected network is not simulated. Training pairs an auditory or visual stimulus on
one side with the teaching signal of that side and applies the same
climbing-fibre-gated LTD. The test presents auditory, visual and audiovisual trials
and reports, per condition, how often the DCN of the stimulated side wins, how often
the other side wins, and how often nothing responds.

### Audiovisual decision — `decision_making`

Builds its **own network**: a two-population attractor (Wang) with a shared
inhibitory pool. Each trial stimulates one side; the response is the first population
whose rate rises above threshold. Trials are 3 s long because the attractor keeps
firing for about 2 s after the stimulus; shorter trials overlap.

## Architecture

| Service    | Tech                                 | Host port                    |
| ---------- | ------------------------------------ | ---------------------------- |
| `frontend` | Angular 18, Tailwind, Cytoscape.js   | 3000 (nginx, proxies `/api`) |
| `api`      | FastAPI, SQLAlchemy 2, Alembic       | 8010 (localhost only)        |
| `worker`   | Celery + PyNEST 3.8 + CerebNEST      | none                         |
| `db`       | MySQL 8.4                            | 3307 (localhost only)        |
| `redis`    | Redis 7 (queue and task state)       | 6380 (localhost only)        |
| `minio`    | MinIO (plots, metrics, spike files)  | 9050, console 9051           |

```
backend/            FastAPI app
  api/routers/      auth, networks, simulations, stimuli
  core/             settings, database session, security, NEST model catalogue
  migrations/       Alembic revisions, applied at startup
  services/         MinIO client, experiment rules, stimulus file parser
  tests/
worker/
  tasks.py          Celery task: picks the experiment, tracks status and abort
  networks/         generic (user networks), cerebellum_msi_race,
                    cerebellum_conditioning, decision_making
  analysis.py       spike analysis (numpy only)
  nest_utils.py     shared NEST helpers
  results.py        writes artefacts to MinIO and graphs.zip
  tests/
frontend/           Angular app
infrastructure/     engine Dockerfile, nginx config
```

The worker runs one simulation at a time (Celery `solo` pool); others wait in the
queue. _Interrompi_ is cooperative: the worker re-reads the simulation status at
every progress update and stops within a few seconds.

Simulations are reproducible: the `seed` parameter drives both NEST and the stimulus
generation.

## Development

Frontend with live reload, against the API of the running stack:

```bash
cd frontend && npm ci && npm start     # http://localhost:4200, /api proxied to :8010
```

Backend and worker code is mounted into the containers; restart them after a change:

```bash
docker compose restart api worker
```

Tests (no NEST, MySQL, Redis or MinIO needed):

```bash
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
pytest
```

or inside the image:

```bash
docker compose run --rm api sh -c "pip install -q -r backend/requirements-dev.txt && python -m pytest -p no:cacheprovider"
```

Database changes go through Alembic: add a revision in `backend/migrations/versions/`;
it is applied when the API starts.

## Configuration

Everything is in `.env`; `.env.example` documents each variable. For anything that
is not a local machine:

- set `ENVIRONMENT` to something other than `development` and generate `SECRET_KEY`
  with `openssl rand -hex 32` (the API refuses to start with the example key);
- choose real passwords for MySQL, MinIO and the first user;
- set `MINIO_EXTERNAL_URL` to the host and port the **browser** uses to reach MinIO,
  otherwise plots do not load;
- put the stack behind HTTPS. There is no login rate limiting.

## Known limits

- The CerebNEST EGLIF models are listed in the editor but were not validated here.
  `eglif_dcnp` in particular fires one spike per input spike on receptor 2, whatever
  the weight, so it cannot be inhibited through that port. Networks saved with EGLIF
  models are converted to `iaf_cond_exp` when run through the multisensory experiment.
- `stdp_synapse_sinexp` needs the CerebNEST volume transmitter, which does not exist
  for NEST 3.8; cerebellar plasticity is therefore applied between trials by the
  experiments themselves and is not available in generic networks.
- Spike recording is capped at the first 250 neurons of each population.

## Citation

> Cavadini, Riccardo, et al. _"Cerebellar contribution to multisensory integration:
> A computational modeling exploration."_ APL Bioengineering 9.2 (2025).
