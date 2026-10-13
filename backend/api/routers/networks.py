import copy
from typing import Any, List, Dict
from fastapi import APIRouter, HTTPException, status, Body
from backend.api.deps import SessionDep, CurrentUser
from backend.models import Network
from backend.schemas import NetworkCreate, NetworkUpdate, NetworkResponse

router = APIRouter(prefix="/networks", tags=["Networks"])

@router.get("/models")
def get_available_models(current_user: CurrentUser) -> Dict[str, List[Dict[str, Any]]]:
    """
    Endpoint di Discovery: Restituisce i moduli NEST supportati, i relativi modelli 
    di neuroni/sinapsi e i loro parametri di default per popolare l'interfaccia.
    """
    return {
        "modules": [
            {
                "id": "nest_standard",
                "label": "NEST Standard",
                "description": "Modelli di base forniti nativamente da NEST Simulator.",
                "neurons": [
                    {
                        "id": "iaf_psc_alpha",
                        "label": "Integrate-and-Fire (Alpha)",
                        "default_params": {"V_m": -70.0, "E_L": -70.0, "C_m": 250.0, "tau_m": 10.0, "t_ref": 2.0, "V_th": -55.0, "V_reset": -70.0}
                    },
                    {
                        "id": "iaf_psc_exp",
                        "label": "Integrate-and-Fire (Exponential)",
                        "default_params": {"V_m": -70.0, "E_L": -70.0, "C_m": 250.0, "tau_m": 10.0, "t_ref": 2.0, "V_th": -55.0, "V_reset": -70.0}
                    },
                    {
                        "id": "iaf_cond_exp",
                        "label": "Integrate-and-Fire (Conductance, Exponential)",
                        "default_params": {"E_L": -70.0, "C_m": 250.0, "g_L": 16.7, "t_ref": 2.0, "V_th": -55.0, "V_reset": -60.0, "tau_syn_ex": 0.2, "tau_syn_in": 2.0}
                    },
                    {
                        "id": "parrot_neuron",
                        "label": "Parrot Neuron (Relay)",
                        "default_params": {}
                    },
                    {
                        "id": "hh_psc_alpha",
                        "label": "Hodgkin-Huxley",
                        "default_params": {"V_m": -65.0, "E_L": -65.0, "C_m": 100.0, "t_ref": 2.0}
                    },
                    {
                        "id": "poisson_generator",
                        "label": "Poisson Generator (Stimulus)",
                        "default_params": {"rate": 0.0, "start": 0.0, "stop": 1000.0}
                    },
                    {
                        "id": "dc_generator",
                        "label": "DC Generator (Stimulus)",
                        "default_params": {"amplitude": 0.0, "start": 0.0, "stop": 1000.0}
                    },
                    # --- VIRTUAL DEVICE AGGIUNTO ---
                    {
                        "id": "legacy_sensory_stimulus",
                        "label": "Sensory Stimulus (Virtual)",
                        "description": "Genera pattern di Poisson filtrati a runtime basati sulla logica dei Trial.",
                        "default_params": {"rate": 20.0, "n_sources": 1}
                    }
                ],
                "synapses": [
                    {
                        "id": "static_synapse",
                        "label": "Static Synapse",
                        "default_params": {"weight": 1.0, "delay": 1.0}
                    },
                    {
                        "id": "stdp_synapse",
                        "label": "STDP Synapse",
                        "default_params": {"weight": 1.0, "delay": 1.0, "lambda": 0.01, "alpha": 1.0, "mu_plus": 1.0, "mu_minus": 1.0}
                    }
                ]
            },
            {
                "id": "cerebnest",
                "label": "CerebNEST (Cervelletto)",
                "description": "Modelli EGLIF avanzati per la simulazione del microcircuito cerebellare.",
                "neurons": [
                    {
                        "id": "eglif_cond_alpha_multisyn",
                        "label": "Granule/Golgi Cell (EGLIF)",
                        "default_params": {"V_m": -70.0, "C_m": 2.0}
                    },
                    {
                        "id": "eglif_pc_nestml",
                        "label": "Purkinje Cell (EGLIF)",
                        "default_params": {"V_m": -60.0, "C_m": 250.0}
                    },
                    {
                        "id": "eglif_mli",
                        "label": "Molecular Layer Interneuron (Basket/Stellate)",
                        "default_params": {"V_m": -60.0, "C_m": 15.0}
                    },
                    {
                        "id": "eglif_io_nestml",
                        "label": "Inferior Olive Cell",
                        "default_params": {"V_m": -60.0, "C_m": 100.0}
                    },
                    {
                        "id": "eglif_dcnp",
                        "label": "Deep Cerebellar Nucleus (DCN)",
                        "default_params": {"V_m": -60.0, "C_m": 150.0}
                    }
                ],
                "synapses": [
                    {
                        "id": "stdp_synapse_alpha",
                        "label": "STDP Synapse (Alpha)",
                        "default_params": {"weight": 1.0, "delay": 1.0, "lambda": 0.01}
                    },
                    {
                        "id": "stdp_synapse_sinexp",
                        "label": "STDP Synapse (SinExp)",
                        "default_params": {"weight": 1.0, "delay": 1.0}
                    },
                    {
                        "id": "static_synapse",
                        "label": "Static Synapse",
                        "default_params": {"weight": 1.0, "delay": 1.0}
                    }
                ]
            }
        ]
    }

@router.get("", response_model=List[NetworkResponse])
def read_networks(db: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100) -> Any:
    """Recupera la lista delle reti appartenenti all'utente loggato."""
    networks = db.query(Network).filter(Network.owner_id == current_user.id).offset(skip).limit(limit).all()
    return networks

@router.post("", response_model=NetworkResponse, status_code=status.HTTP_201_CREATED)
def create_network(*, db: SessionDep, current_user: CurrentUser, network_in: NetworkCreate) -> Any:
    """Crea una nuova rete neurale accettando il payload piatto dal frontend."""
    definition_data = {
        "nodes_count": network_in.nodes_count,
        "edges_count": network_in.edges_count,
        "params": network_in.params,
        "topology": network_in.topology.model_dump()
    }
    network = Network(
        name=network_in.name,
        description=network_in.description,
        definition=definition_data,
        owner_id=current_user.id
    )
    db.add(network)
    db.commit()
    db.refresh(network)
    return network

@router.get("/{id}", response_model=NetworkResponse)
def read_network(*, db: SessionDep, current_user: CurrentUser, id: int) -> Any:
    """Recupera i dettagli completi di una singola rete."""
    network = db.query(Network).filter(Network.id == id, Network.owner_id == current_user.id).first()
    if not network:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Network not found")
    return network

@router.put("/{id}", response_model=NetworkResponse)
def update_network(*, db: SessionDep, current_user: CurrentUser, id: int, network_in: NetworkUpdate) -> Any:
    """Aggiorna i parametri o la topologia di una rete esistente."""
    network = db.query(Network).filter(Network.id == id, Network.owner_id == current_user.id).first()
    if not network:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Network not found")
    
    update_data = network_in.model_dump(exclude_unset=True)
    current_definition = copy.deepcopy(network.definition)
    
    if "nodes_count" in update_data: current_definition["nodes_count"] = update_data["nodes_count"]
    if "edges_count" in update_data: current_definition["edges_count"] = update_data["edges_count"]
    if "params" in update_data: current_definition["params"] = update_data["params"]
    if "topology" in update_data: current_definition["topology"] = update_data["topology"]
    
    network.definition = current_definition
    if "name" in update_data: network.name = update_data["name"]
    if "description" in update_data: network.description = update_data["description"]
        
    db.add(network)
    db.commit()
    db.refresh(network)
    return network

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_network(*, db: SessionDep, current_user: CurrentUser, id: int) -> None:
    """Elimina una rete e ripulisce tutte le simulazioni e i file associati."""
    network = db.query(Network).filter(Network.id == id, Network.owner_id == current_user.id).first()
    if not network:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Network not found")
    
    from backend.models import Simulation
    from backend.services.minio_client import minio_service
    
    simulations = db.query(Simulation).filter(Simulation.network_id == network.id).all()
    
    for sim in simulations:
        if sim.results_path:
            base_path = sim.results_path
            try:
                minio_service.delete_directory(base_path)
            except Exception as e:
                print(f"Attenzione: Errore rimozione {base_path} da MinIO per sim {sim.id}: {e}")
        db.delete(sim)
        
    db.delete(network)
    db.commit()
    return None

@router.post("/{id}/fork", response_model=NetworkResponse, status_code=status.HTTP_201_CREATED)
def fork_network(
    *, 
    db: SessionDep, 
    current_user: CurrentUser, 
    id: int, 
    version_notes: str = Body(..., embed=True, description="Note sulla nuova versione (fork)")
) -> Any:
    """Clona una rete esistente, impostando il parent_id."""
    original_network = db.query(Network).filter(Network.id == id).first()
    if not original_network:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original network not found")
    
    cloned_definition = copy.deepcopy(original_network.definition)
    new_network = Network(
        name=f"{original_network.name} (Fork)",
        description=version_notes,
        definition=cloned_definition,
        parent_id=original_network.id,
        owner_id=current_user.id
    )
    db.add(new_network)
    db.commit()
    db.refresh(new_network)
    return new_network

@router.get("/{id}/topology")
def get_network_topology(*, db: SessionDep, current_user: CurrentUser, id: int) -> dict[str, list[dict[str, Any]]]:
    """Estrae la topologia (nodi e archi) pronta per Cytoscape.js nel Frontend."""
    network = db.query(Network).filter(Network.id == id, Network.owner_id == current_user.id).first()
    if not network:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Network not found")
        
    topology_data = network.definition.get("topology", {})
    nodes = []
    edges = []
    
    populations = topology_data.get("populations", [])
    for pop in populations:
        nodes.append({
            "data": {
                "id": pop.get("id"),
                "label": pop.get("id"),
                "size": pop.get("size"),
                "model": pop.get("neuron_model")
            }
        })
        
    projections = topology_data.get("projections", [])
    for i, proj in enumerate(projections):
        params = proj.get("params", {})
        edges.append({
            "data": {
                "id": f"edge_{i}",
                "source": proj.get("source"),
                "target": proj.get("target"),
                "weight": params.get("weight"),
                "delay": params.get("delay"),
                "synapse_model": proj.get("synapse_model")
            }
        })
        
    return {"nodes": nodes, "edges": edges}