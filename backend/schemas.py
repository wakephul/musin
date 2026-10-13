from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, model_validator

from backend.core.nest_models import CONNECTION_RULES
from backend.models import SimulationStatus

MAX_POPULATION_SIZE = 1_000_000

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


class UserCreate(BaseModel):
    email: EmailStr
    # bcrypt considera solo i primi 72 byte: oltre, due password diverse coinciderebbero.
    password: str = Field(min_length=8, max_length=72)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


# --- Reti ---

class TopologyPopulation(BaseModel):
    id: str = Field(min_length=1, max_length=64)
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
