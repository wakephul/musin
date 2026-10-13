from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from backend.core.nest_models import CONNECTION_RULES
from backend.models import SimulationStatus

MAX_POPULATION_SIZE = 1_000_000
BCRYPT_MAX_BYTES = 72
# Gli id di popolazione finiscono nei nomi dei file dei risultati: niente separatori di percorso.
POPULATION_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$"

# Il database salva le date in UTC senza fuso: vanno dichiarate UTC in uscita,
# altrimenti il browser le legge come ora locale.
UtcDatetime = Annotated[datetime, AfterValidator(lambda value: value if value.tzinfo else value.replace(tzinfo=timezone.utc))]


# --- Utenti e autenticazione ---

class UserResponse(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    created_at: UtcDatetime

    model_config = ConfigDict(from_attributes=True)


def _fits_bcrypt(password: str) -> str:
    # bcrypt considera solo i primi 72 byte: oltre, due password diverse coinciderebbero.
    # Il limite è in byte, non in caratteri (una lettera accentata ne occupa due).
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError(f"La password supera i {BCRYPT_MAX_BYTES} byte")
    return password


Password = Annotated[str, Field(min_length=8), AfterValidator(_fits_bcrypt)]


class UserCreate(BaseModel):
    email: EmailStr
    password: Password


class PasswordChange(BaseModel):
    current_password: str
    new_password: Password


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


# --- Reti ---

class TopologyPopulation(BaseModel):
    id: str = Field(pattern=POPULATION_ID_PATTERN)
    size: int = Field(ge=1, le=MAX_POPULATION_SIZE)
    neuron_model: str = Field(min_length=1)
    params: Dict[str, Any] = Field(default_factory=dict)


class TopologyProjection(BaseModel):
    source: str
    target: str
    rule: str
    synapse_model: str = Field(min_length=1)
    params: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_rule(self) -> "TopologyProjection":
        if self.rule not in CONNECTION_RULES:
            raise ValueError(f"Regola di connessione non supportata: {self.rule}")
        degree_key = {"fixed_indegree": "indegree", "fixed_outdegree": "outdegree", "pairwise_bernoulli": "p"}.get(self.rule)
        if degree_key and degree_key not in self.params:
            raise ValueError(f"La regola {self.rule} richiede il parametro '{degree_key}'")
        return self


class Topology(BaseModel):
    populations: List[TopologyPopulation] = Field(default_factory=list)
    projections: List[TopologyProjection] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_references(self) -> "Topology":
        ids = [pop.id for pop in self.populations]
        duplicates = {pop_id for pop_id in ids if ids.count(pop_id) > 1}
        if duplicates:
            raise ValueError(f"ID di popolazione duplicati: {', '.join(sorted(duplicates))}")
        for proj in self.projections:
            for end in (proj.source, proj.target):
                if end not in ids:
                    raise ValueError(f"La proiezione {proj.source} → {proj.target} usa una popolazione inesistente: {end}")
        return self


class NetworkCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    nodes_count: int = 0
    edges_count: int = 0
    params: Dict[str, Any] = Field(default_factory=dict)
    topology: Topology


class NetworkUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    nodes_count: Optional[int] = None
    edges_count: Optional[int] = None
    params: Optional[Dict[str, Any]] = None
    topology: Optional[Topology] = None


class NetworkFork(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    # Note sulla copia: diventano la sua descrizione (di default resta quella dell'originale).
    version_notes: Optional[str] = None


class NetworkResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    # {nodes_count, edges_count, params, topology}
    definition: Dict[str, Any]
    parent_id: Optional[int] = None
    owner_id: int
    created_at: UtcDatetime
    updated_at: UtcDatetime

    model_config = ConfigDict(from_attributes=True)


# --- Stimoli ---

class StimulusResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    # {n_trains, n_spikes, duration_ms, source_filename}
    definition: Optional[Dict[str, Any]] = None
    owner_id: int
    created_at: UtcDatetime

    model_config = ConfigDict(from_attributes=True)


# --- Simulazioni ---

class SimulationResponse(BaseModel):
    id: int
    name: str
    network_id: int
    campaign_id: Optional[int] = None
    network_name: Optional[str] = None
    owner_id: int
    status: SimulationStatus
    # cerebellum_msi_race | cerebellum_conditioning | decision_making | trial_protocol | continuous
    experiment: str
    duration_ms: float
    experiment_params: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class SimulationPage(BaseModel):
    items: List[SimulationResponse]
    total: int
    # Conteggio per stato su tutte le simulazioni dell'utente, indipendente dai filtri.
    counts: Dict[str, int]


# --- Campagne ---

class Sweep(BaseModel):
    # Percorso del parametro dentro i parametri di lancio, es. "decision_making.auditory_latency_ms".
    path: str = Field(min_length=1, max_length=120)
    values: List[float]


class CampaignCreate(BaseModel):
    network_id: int
    name: Optional[str] = Field(default=None, max_length=255)
    params: Dict[str, Any]
    seeds: List[int] = Field(min_length=1, max_length=50)
    sweep: Optional[Sweep] = None
    # Gli spike di ogni simulazione: spenti di default, una campagna ne produce molti.
    save_spikes: bool = False

    @field_validator("seeds")
    @classmethod
    def seeds_in_range(cls, seeds: List[int]) -> List[int]:
        if any(not 0 <= seed < 2**31 for seed in seeds):
            raise ValueError("I seed devono essere interi non negativi")
        return seeds


class CampaignUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    # "builtin:<chiave>", "user:<id>" oppure null per togliere il confronto.
    reference: Optional[str] = Field(default=None, max_length=64)


class CampaignMember(BaseModel):
    id: int
    seed: Optional[int] = None
    value: Optional[float] = None
    status: SimulationStatus
    error_message: Optional[str] = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    network_id: int
    network_name: Optional[str] = None
    experiment: str
    params: Dict[str, Any]
    seeds: List[int]
    sweep: Optional[Sweep] = None
    reference: Optional[str] = None
    # Durata biologica di tutte le simulazioni insieme.
    duration_ms: float
    # Simulazioni per stato.
    counts: Dict[str, int]
    created_at: UtcDatetime
    simulations: List[CampaignMember] = Field(default_factory=list)


class ReferenceSetResponse(BaseModel):
    # "builtin:<chiave>" o "user:<id>": è il valore da mettere in `reference` di una campagna.
    key: str
    name: str
    source: Optional[str] = None
    # Numero di tempi di risposta per condizione.
    responses: Dict[str, int]
    deletable: bool
