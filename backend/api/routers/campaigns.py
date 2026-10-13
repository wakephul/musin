from typing import List

from fastapi import APIRouter, HTTPException, status

from backend.api.deps import CurrentUser, SessionDep
from backend.api.routers.references import resolve as resolve_reference
from backend.models import Campaign, Network, Simulation, SimulationStatus
from backend.schemas import CampaignCreate, CampaignMember, CampaignResponse, CampaignUpdate
from backend.services.campaigns import CampaignError, delete_campaign_rows, expand, seed_path, summarise
from backend.services.experiments import experiment_kind
from backend.services.launching import checked_duration_ms, enqueue, reject_non_finite
from backend.services.storage import storage

router = APIRouter(prefix="/campaigns", tags=["Campaigns"])

FINAL_STATUSES = (SimulationStatus.COMPLETED, SimulationStatus.FAILED, SimulationStatus.ABORTED)

# Il riepilogo costa qualche secondo (ricampionamenti): si ricalcola solo quando cambiano
# le simulazioni completate o il set di riferimento.
_summaries: dict = {}
MAX_CACHED_SUMMARIES = 32


def _get_owned_campaign(db, campaign_id: int, user_id: int) -> Campaign:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id, Campaign.owner_id == user_id).first()
    if not campaign:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campagna non trovata")
    return campaign


def _lookup(params: dict, path: tuple):
    for key in path:
        params = params.get(key) if isinstance(params, dict) else None
    return params


def _member(simulation: Simulation, campaign: Campaign) -> CampaignMember:
    params = simulation.experiment_params or {}
    value = _lookup(params, tuple(campaign.sweep["path"].split("."))) if campaign.sweep else None
    return CampaignMember(id=simulation.id, seed=_lookup(params, seed_path(params)), value=value,
                          status=simulation.status, error_message=simulation.error_message)


def _to_response(campaign: Campaign, simulations: List[Simulation], with_members: bool) -> CampaignResponse:
    counts = dict.fromkeys((s.value for s in SimulationStatus), 0)
    for simulation in simulations:
        counts[simulation.status.value] += 1
    return CampaignResponse(
        id=campaign.id,
        name=campaign.name,
        network_id=campaign.network_id,
        network_name=campaign.network.name if campaign.network else None,
        experiment=experiment_kind(campaign.params),
        params=campaign.params,
        seeds=campaign.seeds,
        sweep=campaign.sweep,
        reference=campaign.reference,
        duration_ms=sum(simulation.duration_ms for simulation in simulations),
        counts=counts,
        created_at=campaign.created_at,
        simulations=[_member(simulation, campaign) for simulation in simulations] if with_members else [],
    )


def _simulations(db, campaign_ids: list[int]) -> dict:
    by_campaign = {campaign_id: [] for campaign_id in campaign_ids}
    for simulation in db.query(Simulation).filter(Simulation.campaign_id.in_(campaign_ids)).order_by(Simulation.id):
        by_campaign[simulation.campaign_id].append(simulation)
    return by_campaign


@router.get("", response_model=List[CampaignResponse])
def read_campaigns(db: SessionDep, current_user: CurrentUser) -> list[CampaignResponse]:
    campaigns = db.query(Campaign).filter(Campaign.owner_id == current_user.id).order_by(Campaign.id.desc()).all()
    simulations = _simulations(db, [campaign.id for campaign in campaigns])
    return [_to_response(campaign, simulations[campaign.id], with_members=False) for campaign in campaigns]


@router.post("", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
def create_campaign(db: SessionDep, current_user: CurrentUser, body: CampaignCreate) -> CampaignResponse:
    network = db.query(Network).filter(Network.id == body.network_id, Network.owner_id == current_user.id).first()
    if not network:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rete non trovata")
    reject_non_finite(body.params)
    sweep = body.sweep.model_dump() if body.sweep else None
    try:
        members = expand(body.params, body.seeds, sweep, body.save_spikes)
    except CampaignError as exc:
        raise HTTPException(422, str(exc)) from exc
    # Tutte controllate prima di crearne una: una campagna non parte a metà.
    durations = [checked_duration_ms(db, params, current_user.id) for _, _, params in members]

    name = body.name or network.name
    campaign = Campaign(name=name, network_id=network.id, owner_id=current_user.id,
                        params=body.params, seeds=body.seeds, sweep=sweep)
    db.add(campaign)
    db.flush()
    simulations = [
        Simulation(name=name, network_id=network.id, campaign_id=campaign.id, duration_ms=duration,
                   experiment_params=params, network_definition=network.definition,
                   owner_id=current_user.id, status=SimulationStatus.PENDING)
        for (_, _, params), duration in zip(members, durations)
    ]
    db.add_all(simulations)
    db.commit()
    enqueue(db, simulations)
    return _to_response(campaign, simulations, with_members=True)


@router.get("/{campaign_id}", response_model=CampaignResponse)
def get_campaign(db: SessionDep, current_user: CurrentUser, campaign_id: int) -> CampaignResponse:
    campaign = _get_owned_campaign(db, campaign_id, current_user.id)
    return _to_response(campaign, _simulations(db, [campaign.id])[campaign.id], with_members=True)


@router.put("/{campaign_id}", response_model=CampaignResponse)
def update_campaign(db: SessionDep, current_user: CurrentUser, campaign_id: int, body: CampaignUpdate) -> CampaignResponse:
    campaign = _get_owned_campaign(db, campaign_id, current_user.id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name"):
        campaign.name = changes["name"]
    if "reference" in changes:
        if changes["reference"] is not None and resolve_reference(db, changes["reference"], current_user.id) is None:
            raise HTTPException(422, "Set di riferimento non trovato")
        campaign.reference = changes["reference"]
    db.commit()
    return _to_response(campaign, _simulations(db, [campaign.id])[campaign.id], with_members=True)


@router.get("/{campaign_id}/summary")
def get_campaign_summary(db: SessionDep, current_user: CurrentUser, campaign_id: int) -> dict:
    """Tempi di risposta delle simulazioni completate messi insieme, per valore del parametro variabile."""
    campaign = _get_owned_campaign(db, campaign_id, current_user.id)
    completed = [
        simulation for simulation in _simulations(db, [campaign.id])[campaign.id]
        if simulation.status == SimulationStatus.COMPLETED and simulation.results_path
    ]
    key = (campaign.id, tuple(simulation.id for simulation in completed), campaign.reference)
    if key not in _summaries:
        members = []
        for simulation in completed:
            member = _member(simulation, campaign)
            try:
                entries = storage.read_json(f"{simulation.results_path}/race_model.json")["race_model"]
            except (FileNotFoundError, KeyError, ValueError):
                entries = []     # l'esperimento non produce tempi di risposta per condizione
            members.append((simulation.id, member.seed, member.value, entries))
        if len(_summaries) >= MAX_CACHED_SUMMARIES:
            _summaries.pop(next(iter(_summaries)))
        _summaries[key] = summarise(members, resolve_reference(db, campaign.reference, current_user.id))
    return {"completed": len(completed), "reference": campaign.reference, "points": _summaries[key]}


@router.post("/{campaign_id}/abort")
def abort_campaign(db: SessionDep, current_user: CurrentUser, campaign_id: int) -> dict:
    """Ferma le simulazioni non ancora concluse; quelle completate restano."""
    campaign = _get_owned_campaign(db, campaign_id, current_user.id)
    # Il worker rilegge lo stato a ogni avanzamento (vedi worker.tasks._is_aborted).
    aborted = db.query(Simulation).filter(
        Simulation.campaign_id == campaign.id, Simulation.status.notin_(FINAL_STATUSES)
    ).update({"status": SimulationStatus.ABORTED}, synchronize_session=False)
    db.commit()
    return {"aborted": aborted}


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(db: SessionDep, current_user: CurrentUser, campaign_id: int) -> None:
    """Elimina la campagna. Una simulazione in corso si ferma al controllo successivo del worker."""
    delete_campaign_rows(db, _get_owned_campaign(db, campaign_id, current_user.id))
    db.commit()
