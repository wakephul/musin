import copy
from typing import List

from fastapi import APIRouter, HTTPException, status

from backend.api.deps import CurrentUser, SessionDep
from backend.core.nest_models import MODEL_CATALOGUE
from backend.models import Campaign, Network, Simulation
from backend.schemas import NetworkCreate, NetworkFork, NetworkResponse, NetworkUpdate
from backend.services.campaigns import delete_campaign_rows
from backend.services.storage import storage

router = APIRouter(prefix="/networks", tags=["Networks"])


def _get_owned_network(db, network_id: int, user_id: int) -> Network:
    network = db.query(Network).filter(Network.id == network_id, Network.owner_id == user_id).first()
    if not network:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rete non trovata")
    return network


@router.get("/models")
def get_available_models(current_user: CurrentUser) -> dict:
    return MODEL_CATALOGUE


@router.get("", response_model=List[NetworkResponse])
def read_networks(db: SessionDep, current_user: CurrentUser) -> list[Network]:
    return (
        db.query(Network)
        .filter(Network.owner_id == current_user.id)
        .order_by(Network.updated_at.desc(), Network.id.desc())
        .all()
    )


@router.post("", response_model=NetworkResponse, status_code=status.HTTP_201_CREATED)
def create_network(db: SessionDep, current_user: CurrentUser, network_in: NetworkCreate) -> Network:
    network = Network(
        name=network_in.name,
        description=network_in.description,
        definition={
            "nodes_count": network_in.nodes_count,
            "edges_count": network_in.edges_count,
            "params": network_in.params,
            "topology": network_in.topology.model_dump(),
        },
        owner_id=current_user.id,
    )
    db.add(network)
    db.commit()
    db.refresh(network)
    return network


@router.get("/{network_id}", response_model=NetworkResponse)
def read_network(db: SessionDep, current_user: CurrentUser, network_id: int) -> Network:
    return _get_owned_network(db, network_id, current_user.id)


@router.put("/{network_id}", response_model=NetworkResponse)
def update_network(db: SessionDep, current_user: CurrentUser, network_id: int, network_in: NetworkUpdate) -> Network:
    network = _get_owned_network(db, network_id, current_user.id)
    # null esplicito ha senso solo per la descrizione (la svuota); altrove vale "non cambiare".
    update_data = {key: value for key, value in network_in.model_dump(exclude_unset=True).items()
                   if value is not None or key == "description"}

    # Il JSON va riassegnato per intero: SQLAlchemy non rileva le modifiche in place.
    definition = copy.deepcopy(network.definition)
    for key in ("nodes_count", "edges_count", "params", "topology"):
        if key in update_data:
            definition[key] = update_data[key]
    network.definition = definition
    for key in ("name", "description"):
        if key in update_data:
            setattr(network, key, update_data[key])

    db.add(network)
    db.commit()
    db.refresh(network)
    return network


@router.delete("/{network_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_network(db: SessionDep, current_user: CurrentUser, network_id: int) -> None:
    """Elimina la rete con le sue simulazioni e i relativi risultati."""
    network = _get_owned_network(db, network_id, current_user.id)
    for campaign in db.query(Campaign).filter(Campaign.network_id == network.id).all():
        delete_campaign_rows(db, campaign)
    for simulation in db.query(Simulation).filter(Simulation.network_id == network.id).all():
        if simulation.results_path:
            storage.delete_tree(simulation.results_path)
        db.delete(simulation)
    db.delete(network)
    db.commit()


@router.post("/{network_id}/fork", response_model=NetworkResponse, status_code=status.HTTP_201_CREATED)
def fork_network(db: SessionDep, current_user: CurrentUser, network_id: int, body: NetworkFork | None = None) -> Network:
    """Crea una copia della rete che ricorda l'originale in `parent_id`."""
    original = _get_owned_network(db, network_id, current_user.id)
    fork = Network(
        name=(body.name if body and body.name else f"{original.name} (copia)"),
        description=(body.version_notes if body and body.version_notes else original.description),
        definition=copy.deepcopy(original.definition),
        parent_id=original.id,
        owner_id=current_user.id,
    )
    db.add(fork)
    db.commit()
    db.refresh(fork)
    return fork
