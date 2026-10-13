import enum
from datetime import datetime
from typing import Optional, List, Any
from sqlalchemy import String, ForeignKey, JSON, Enum, DateTime, func, Text, Float
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class SimulationStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    ABORTED = "ABORTED"

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    networks: Mapped[List["Network"]] = relationship("Network", back_populates="owner", cascade="all, delete-orphan")
    stimuli: Mapped[List["Stimulus"]] = relationship("Stimulus", back_populates="owner", cascade="all, delete-orphan")
    simulations: Mapped[List["Simulation"]] = relationship("Simulation", back_populates="owner", cascade="all, delete-orphan")

class Network(Base):
    __tablename__ = "networks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    definition: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("networks.id", ondelete="SET NULL"), nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner: Mapped["User"] = relationship("User", back_populates="networks")
    parent: Mapped[Optional["Network"]] = relationship("Network", remote_side=[id], backref="forks")
    simulations: Mapped[List["Simulation"]] = relationship("Simulation", back_populates="network")

class Stimulus(Base):
    __tablename__ = "stimuli"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    definition: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stimuli.id", ondelete="SET NULL"), nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner: Mapped["User"] = relationship("User", back_populates="stimuli")
    parent: Mapped[Optional["Stimulus"]] = relationship("Stimulus", remote_side=[id], backref="forks")
    simulations: Mapped[List["Simulation"]] = relationship("Simulation", back_populates="stimulus")

class Campaign(Base):
    """Lo stesso esperimento ripetuto con più seed e, se indicato, con un parametro che varia.
    Ogni combinazione è una simulazione con `campaign_id` uguale all'id della campagna."""
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    network_id: Mapped[int] = mapped_column(ForeignKey("networks.id", ondelete="RESTRICT"), nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Parametri comuni a tutte le simulazioni; seed e parametro variabile li sovrascrivono.
    params: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    seeds: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    # {"path": "decision_making.auditory_latency_ms", "values": [150, 180]} oppure null.
    sweep: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    # Set di riferimento con cui si confrontano i risultati: "builtin:<chiave>" o "user:<id>".
    reference: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    network: Mapped["Network"] = relationship("Network")


class ReferenceSet(Base):
    """Tempi di risposta di riferimento caricati dall'utente, per condizione."""
    __tablename__ = "reference_sets"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # {"A": [ms, ...], "V": [...], "AV": [...], "race": [...]}
    conditions: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Simulation(Base):
    __tablename__ = "simulations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    
    network_id: Mapped[int] = mapped_column(ForeignKey("networks.id", ondelete="RESTRICT"), nullable=False)
    campaign_id: Mapped[Optional[int]] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=True, index=True)
    stimulus_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stimuli.id", ondelete="SET NULL"), nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    duration_ms: Mapped[float] = mapped_column(Float, default=1000.0, nullable=False)
    experiment_params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    # Definizione della rete al momento del lancio: modificare la rete dopo non cambia
    # ciò che una simulazione in coda calcola, né ciò che una conclusa ha calcolato.
    network_definition: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    status: Mapped[SimulationStatus] = mapped_column(Enum(SimulationStatus), default=SimulationStatus.PENDING, nullable=False)
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True, nullable=True)
    results_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner: Mapped["User"] = relationship("User", back_populates="simulations")
    network: Mapped["Network"] = relationship("Network", back_populates="simulations")
    stimulus: Mapped[Optional["Stimulus"]] = relationship("Stimulus", back_populates="simulations")