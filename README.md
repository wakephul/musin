# MuSiN — Multiple Simulations on NEST

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

**MuSiN** is a full-stack platform for building, running and analysing **Spiking
Neural Network** simulations on the **NEST** simulator (3.8) + the **CerebNEST**
cerebellar module. It exposes a visual network builder and an asynchronous
simulation runner through a web UI, so both engineers and researchers can launch
and inspect experiments without writing NEST code.

Its flagship use case is the _in silico_ study of the **cerebellar contribution to
audiovisual multisensory integration**, verified with the **Race Model Inequality**
(Miller 1982). The computational model and this experiment are published in:

> Cavadini, Riccardo, et al. _"Cerebellar contribution to multisensory integration:
> A computational modeling exploration."_ APL Bioengineering 9.2 (2025).

It computationally replicates the clinical findings of:

> Ronconi, Luca, et al. _"When one is enough: Impaired multisensory integration in
> cerebellar agenesis."_ Cerebral Cortex 27.3 (2017): 2041–2051.

---

## Architecture

Microservices orchestrated with Docker Compose:

| Service    | Tech                                    | Host port                           | Purpose                                                   |
| ---------- | --------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| `frontend` | Angular 18 + TailwindCSS + Cytoscape.js | **3000**                            | Web UI (nginx static; also proxies `/api/v1/`)            |
| `api`      | Python 3.12, FastAPI, SQLAlchemy 2.0    | **8010**                            | REST API                                                  |
| `worker`   | Celery + PyNEST 3.8 + CerebNEST         | —                                   | Async simulation execution                                |
| `db`       | MySQL 8.4                               | **3307**                            | Metadata, users, simulation history                       |
| `redis`    | Redis 7                                 | **6380**                            | Celery broker + result backend                            |
| `minio`    | MinIO                                   | **9050** (API) / **9051** (console) | Object storage for simulation outputs (plots, JSON, zips) |

The NEST/CerebNEST engine is compiled from source inside the `api`/`worker`
images, so the **first build is slow**.

---

## Quick start

### Prerequisites

- Docker Engine 24+ and Docker Compose v2+
- At least 8 GB RAM dedicated to Docker (16 GB recommended for full-size networks)

### Setup

```bash
# 1. Copy the env template and fill in the values
cp .env.example .env
#    (edit .env: set passwords + a strong SECRET_KEY via `openssl rand -hex 32`)

# 2. Build and start the whole stack
docker compose up --build -d
```

### Service URLs

| What             | URL                                       |
| ---------------- | ----------------------------------------- |
| Web app          | http://localhost:3000                     |
| API Swagger docs | http://localhost:8010/docs                |
| API ReDoc        | http://localhost:8010/redoc               |
| OpenAPI schema   | http://localhost:8010/api/v1/openapi.json |
| MinIO console    | http://localhost:9051                     |

Note: Swagger UI lives at `/docs` (FastAPI default); only the OpenAPI schema is
served under `/api/v1`. Default login is the bootstrap superuser from `.env`
(`FIRST_SUPERUSER_EMAIL` / `FIRST_SUPERUSER_PASSWORD`).

---

## Using the app

- **Dashboard** — lists your networks (with neuron/synapse counts) and your
  simulation history. Per-network actions: **Simula**, **Dettagli/Modifica**,
  **Elimina** (icon buttons with tooltips).
- **Network Builder** (`/networks/new`) — define populations, projections and
  biological parameters visually; one-click load of validated network presets.
- **Network detail / fork** (`/networks/:id`) — open an existing network in the
  builder to **edit it in place** (_Salva modifiche_) or **fork it** into a new
  copy (_Salva come copia_).
- **Run a simulation** (`/simulations/run/:id`) — pick a validated **protocol
  preset**. Once a protocol is loaded the experiment is **locked** (no accidental
  mode/protocol switching); use _Cambia protocollo_ to reopen the choice.
- **Simulation detail** (`/simulations/detail/:id`) — live status/progress, all
  generated plots and metrics, the stimulus-device description, and a **network
  summary with a read-only "complete details" modal**.

---

## Built-in experiments

Some experiments can't be expressed through the generic populations/projections
JSON contract (they need PSP-normalised weights, multisynapse receptors, emulated
plasticity, or dedicated analysis). They run via dedicated worker modules under
`worker/networks/`, selected by the `builtin` field of the launch params.

Two are exposed in the UI as **protocol presets** (Step 1 of "Run New Simulation"),
both paired with the **Cerebellar Microcircuit (GR→PC→DCN, vie A/B)** network:

### Associative Conditioning (A vs B) — `builtin: cerebellum_conditioning`

`worker/networks/cerebellum_conditioning.py`. Eyeblink-style conditioning over two
pathways (`GR`, `PC_A/PC_B`, `IO_A/IO_B`, `DCN_A/DCN_B`). Training (plasticity ON):
auditory **or** visual trial with an IO teaching signal (8.5 Hz, 300–600 ms).
Because NEST 3.8 has no `volume_transmitter_alberto`, cerebellar **LTD is emulated
manually** after each trial (CF-gated anti-Hebbian depression of `GR→PC`).
Test (plasticity OFF): auditory / visual / audiovisual.

### AV Multisensory Integration — Train + Test — `builtin: cerebellum_msi_race`

`worker/networks/cerebellum_msi_race.py`. Full _in silico_ replication of the
cerebellar contribution to AV multisensory integration (Cavadini et al. 2025),
verified with the Miller Race Model Inequality. Detailed below.

### Network presets (Network Builder)

- **Cerebellar Microcircuit (GR→PC→DCN, vie A/B)** — canonical cerebellar
  microcircuit with IO teaching signal; the network used by both cerebellar
  experiments. Default size matches the reference protocol: **GR 2000, PC 100,
  IO 100, DCN 50** (split A/B), about 2 500 neurons.
- **Associative Conditioning (A vs B)** — variant with precabled CS/US devices.

> An additional `decision_making` worker module (Wang attractor decision network,
> `worker/networks/decision_making.py`) also exists and is launchable through the
> API (`builtin: decision_making`), but it is **not** currently surfaced as a UI
> protocol preset.

---

## The AV Multisensory Integration experiment (Race Model)

Replicates the audiovisual facilitation and tests it with the **Race Model
Inequality** (Miller 1982), following Cavadini et al. 2025. Because there is no
pre-trained cerebellum, it runs in **two phases**: first **train** (cerebellar
disinhibition learning), then **test** (plasticity off, measure reaction times).

### Network & models

Use the **"Cerebellar Microcircuit (GR→PC→DCN, vie A/B)"** preset
(`GR`, `PC_A`, `PC_B`, `IO_A`, `IO_B`, `DCN_A`, `DCN_B`). The task **overrides** the
EGLIF pacemakers with `iaf_cond_exp` (PC, DCN) and `parrot_neuron` (IO) so every
population has a **0 Hz baseline** and fires only with synaptic drive — required for
clean rate-threshold reaction times.

### Phase 1 — Training

`CS → GR → PC_A` with the teaching signal `US_A → IO_A`. Cerebellar **LTD is emulated
manually** (no `volume_transmitter_alberto` in NEST 3.8): each trial depresses
`GR→PC_A` until **PC_A is silenced** → it stops inhibiting `DCN_A` (disinhibition).
`GR→PC_B` is never taught, so `PC_B` stays active and keeps `DCN_B` silent.

### Phase 2 — Test

Interleaved **V / A / AV / CATCH** trials (about 30/30/30/10 %).

- **PC→DCN is inhibitory** via a **negative** weight (`-20`, matching the reference
  `Init_PCDCN`). `iaf_cond_exp` has no inhibitory receptor port, so the weight sign
  selects the inhibitory conductance. This keeps `DCN_B` silent → the `DCN_A − DCN_B`
  decision is about 100 % accurate.
- **A+V is coactivation:** the `VIS` and `AUD` spike generators fire concurrently as
  two **independent** Poisson trains (not merged); their conductances **sum** at
  `DCN_A` (40 vs 20 afferents). The `MF→DCN_A` weight is tuned so a single modality is
  near-threshold/slow while A+V crosses the 15 Hz threshold fast.
- **Latencies** auditory 180 ms / visual 220 ms; the small gap is essential,
  otherwise the auditory channel alone crosses before the visual component of an AV
  trial arrives.
- **Reaction time** is a **race across populations**: the earliest 15 Hz crossing of
  any DCN. CDFs feed the Miller RMI.

> **Sensory input note:** stimuli are **600 ms** windows (reference
> `execution_types.json` `trial_duration: 600`). The reference values are 30 Hz ×
> 80 neurons (aud latency 150, vis 220); MuSiN's NEST-3.8 port uses lighter,
> retuned Poisson drive (20 Hz × 20 sources, latencies 180/220) so the coactivation
> regime yields the AV-leftmost CDF. All of these are exposed as `test.*` params.

### Run it (UI)

1. **Run New Simulation** → protocol **"AV Multisensory Integration — Train + Test"**.
2. Pick the **"Cerebellar Microcircuit (GR→PC→DCN, vie A/B)"** network.
3. Start. About 4–7 min (train 45 + test 100 trials).

### Run it (API)

```bash
TOK=$(curl -s -X POST http://localhost:8010/api/v1/auth/login \
  -d 'username=test@test.it&password=test' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

PARAMS='{"builtin":"cerebellum_msi_race","seed":2016,"resolution":0.1,
"train":{"n_trials":45,"trial_duration_ms":1000,"stimulus_duration_ms":300,"iti_range_ms":[500,1000],"cs_rate":20.0,"cs_n_sources":20,"us_rate":8.5,"us_n_sources":10},
"test":{"n_trials":100,"trial_duration_ms":1000,"stimulus_duration_ms":600,"iti_range_ms":[200,400],"vis_rate":20.0,"aud_rate":20.0,"n_sources":20,"aud_latency_ms":180,"vis_latency_ms":220,"mf_dcn_weight_low":0.34,"mf_dcn_weight_high":0.40}}'

curl -s -X POST http://localhost:8010/api/v1/simulations/launch \
  -H "Authorization: Bearer $TOK" \
  -F "network_id=<NETWORK ID>" -F "params=$PARAMS"
```

### Outputs (in MinIO + the zip)

- `rmi_DCN_A.png` — RT CDFs for V/A/AV + the Miller bound; green area = RMI violation.
- `cdf_test_DCN_AB.png` — per-condition RT CDF (expected: **AV leftmost**).
- `accuracy_metrics.json` — `DCN_A vs DCN_B` decision accuracy (expected about 100 %).
- `race_model.json` — `median_rt_ms`, `max_rmi_violation`, `has_facilitation`,
  `winner_counts`. Expected: `RT(AV) << RT(A) < RT(V)` and `has_facilitation: true`.
- `diff_DCN_A_DCN_B.png`, per-population raster + PSTH, `spikes.json`, `graphs.zip`.

---

## API overview

Base path `http://localhost:8010/api/v1`. Interactive docs at
`http://localhost:8010/docs`.

| Prefix         | Purpose                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/auth`        | Login (JWT bearer token)                                                                                           |
| `/networks`    | CRUD networks,`GET /{id}/topology`, `PUT /{id}` (update), `POST /{id}/fork`, `GET /models` (available NEST models) |
| `/simulations` | `POST /launch`, `GET /{id}/status`, `GET /{id}/results`, `POST /{id}/abort`, `DELETE /{id}`                        |
| `/stimuli`     | Stimulus definitions                                                                                               |

---

## Project structure

```
/musin
├── backend/          # FastAPI app: routers (auth, networks, simulations, stimuli),
│                     #   schemas, models, core services
├── worker/           # Celery worker + PyNEST experiments
│   ├── tasks.py      #   dispatch (built-in experiments vs generic networks)
│   └── networks/     #   decision_making, cerebellum_conditioning, cerebellum_msi_race
├── frontend/         # Angular 18 web app (served by nginx in the image)
├── infrastructure/   # nginx config, DB/init scripts, engine Dockerfile
├── test/             # tests
├── docker-compose.yml
├── .env.example      # environment template (copy to .env)
└── .gitignore
```

---

## Environment variables

All configuration lives in `.env` (git-ignored). Start from `.env.example`, which
documents every variable: MySQL credentials + bootstrap superuser, the SQLAlchemy
`DATABASE_URL`, Redis broker URLs, MinIO credentials/URLs/bucket, and the JWT
`SECRET_KEY` / `ALGORITHM` / token lifetime. Generate a strong secret with
`openssl rand -hex 32` before any non-local deployment.

---

## Citation

If you use MuSiN or this multisensory-integration model, please cite:

> Cavadini, Riccardo, et al. _"Cerebellar contribution to multisensory integration:
> A computational modeling exploration."_ APL Bioengineering 9.2 (2025).
