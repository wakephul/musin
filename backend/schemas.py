from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime
from backend.models import SimulationStatus

# ==========================================
# 1. USER SCHEMAS
# ==========================================
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

# ==========================================
# 2. AUTH SCHEMAS
# ==========================================
class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class TokenData(BaseModel):
    email: Optional[str] = None

# ==========================================
# 3. NETWORK TOPOLOGY SCHEMAS (Allineato al Frontend!)
# ==========================================
class TopologyPopulation(BaseModel):
    id: str
    size: int
    neuron_model: str
    params: Dict[str, Any] = Field(default_factory=dict)

class TopologyProjection(BaseModel):
    source: str
    target: str
    rule: str
    synapse_model: str
    params: Dict[str, Any] = Field(default_factory=dict)

class Topology(BaseModel):
    populations: List[TopologyPopulation] = Field(default_factory=list)
    projections: List[TopologyProjection] = Field(default_factory=list)

class NetworkDefinitionJSON(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict)
    topology: Topology

# ==========================================
# 4. NETWORK SCHEMAS
# ==========================================
class NetworkCreate(BaseModel):
    name: str
    description: Optional[str] = None
    nodes_count: int = 0
    edges_count: int = 0
    params: Dict[str, Any] = Field(default_factory=dict)
    topology: Topology

class NetworkUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes_count: Optional[int] = None
    edges_count: Optional[int] = None
    params: Optional[Dict[str, Any]] = None
    topology: Optional[Topology] = None

class NetworkResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    # Il DB restituirà sempre il campo JSON unificato 'definition'
    definition: Dict[str, Any] 
    parent_id: Optional[int] = None
    owner_id: int
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

# ==========================================
# 5. STIMULUS SCHEMAS
# ==========================================
class StimulusBase(BaseModel):
    name: str
    description: Optional[str] = None
    definition: Optional[Dict[str, Any]] = None

class StimulusCreate(StimulusBase):
    pass

class StimulusResponse(StimulusBase):
    id: int
    file_path: Optional[str]
    parent_id: Optional[int] = None
    owner_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ==========================================
# 6. SIMULATION SCHEMAS
# ==========================================
class SimulationBase(BaseModel):
    name: str
    network_id: int
    stimulus_id: Optional[int] = None

class SimulationCreate(SimulationBase):
    pass

class SimulationResponse(SimulationBase):
    id: int
    owner_id: int
    status: SimulationStatus
    celery_task_id: Optional[str] = None
    results_path: Optional[str] = None
    duration_ms: float = 0.0
    experiment_params: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)