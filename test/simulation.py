import requests
import json
import time

# ==========================================
# 1. CONFIGURAZIONE AMBIENTE
# ==========================================
BASE_URL = "http://localhost:8000/api/v1"
USERNAME = "test@test.it"
PASSWORD = "test"
NETWORK_ID = "11"

# ==========================================
# 2. DEFINIZIONE DEL PROTOCOLLO (JSON PAYLOAD)
# ==========================================
experiment_payload = {
    "protocol": {
        "num_trials": 15, "trial_duration_ms": 1000.0, "iti_ms": 2000.0,
        "stimuli_pool": [
            {"devices": ["CS_A1", "CS_A2", "US_A"], "weight": 1.0},
            {"devices": ["CS_B1", "CS_B2", "US_B"], "weight": 1.0}
        ]
    },
    "inputs": {
        "devices": [
            {"id": "CS_A1", "model": "legacy_sensory_stimulus", "params": {"rate": 20.0, "n_sources": 20}},
            {"id": "CS_A2", "model": "legacy_sensory_stimulus", "params": {"rate": 20.0, "n_sources": 20}},
            {"id": "CS_B1", "model": "legacy_sensory_stimulus", "params": {"rate": 20.0, "n_sources": 20}},
            {"id": "CS_B2", "model": "legacy_sensory_stimulus", "params": {"rate": 20.0, "n_sources": 20}},
            {"id": "US_A", "model": "legacy_sensory_stimulus", "params": {"rate": 8.5, "n_sources": 10}},
            {"id": "US_B", "model": "legacy_sensory_stimulus", "params": {"rate": 8.5, "n_sources": 10}}
        ],
        "connections": [
            {"source": "CS_A1", "target": "GR", "rule": "fixed_indegree", "synapse_model": "static_synapse", "params": {"indegree": 1, "weight": 1.2, "delay": 1.0}},
            {"source": "CS_A2", "target": "GR", "rule": "fixed_indegree", "synapse_model": "static_synapse", "params": {"indegree": 1, "weight": 1.2, "delay": 1.0}},
            {"source": "CS_B1", "target": "GR", "rule": "fixed_indegree", "synapse_model": "static_synapse", "params": {"indegree": 1, "weight": 1.2, "delay": 1.0}},
            {"source": "CS_B2", "target": "GR", "rule": "fixed_indegree", "synapse_model": "static_synapse", "params": {"indegree": 1, "weight": 1.2, "delay": 1.0}},
            {"source": "CS_A1", "target": "DCN_A", "rule": "all_to_all", "synapse_model": "static_synapse", "params": {"weight": 0.6, "delay": 20.0, "receptor_type": 1}},
            {"source": "CS_B1", "target": "DCN_B", "rule": "all_to_all", "synapse_model": "static_synapse", "params": {"weight": 0.6, "delay": 20.0, "receptor_type": 1}},
            {"source": "US_A", "target": "IO_A", "rule": "all_to_all", "synapse_model": "static_synapse", "params": {"weight": 1.0, "delay": 1.0, "receptor_type": 1}},
            {"source": "US_B", "target": "IO_B", "rule": "all_to_all", "synapse_model": "static_synapse", "params": {"weight": 1.0, "delay": 1.0, "receptor_type": 1}}
        ]
    }
}

def main():
    print("🚀 Inizio automazione MuSiN...")

    # ==========================================
    # 3. LOGIN & AUTHENTICATION
    # ==========================================
    print("🔑 Autenticazione in corso...")
    # NOTA: FastAPI di default usa "application/x-www-form-urlencoded" per il login OAuth2
    auth_data = {
        "username": USERNAME,
        "password": PASSWORD
    }
    # Potrebbe essere /login/access-token o /auth/login a seconda di come l'ha impostata il backend lead
    auth_response = requests.post(f"{BASE_URL}/auth/login", data=auth_data)
    
    if auth_response.status_code != 200:
        print(f"❌ Errore di Login: {auth_response.text}")
        return

    token = auth_response.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}"}
    print("✅ Login effettuato. Token ottenuto.")

    # ==========================================
    # 4. LANCIO SIMULAZIONE (Form Data)
    # ==========================================
    print(f"🧪 Lancio protocollo sperimentale sulla rete {NETWORK_ID}...")
    
    # In Python 'requests', per simulare un FormData si usa il dizionario 'data' 
    # assicurandosi di inviare i nested dicts/lists come stringhe JSON pure
    form_data = {
        "network_id": NETWORK_ID,
        "params": json.dumps(experiment_payload)
    }

    launch_response = requests.post(
        f"{BASE_URL}/simulations/launch",
        headers=headers,
        data=form_data
        # files={"stimuli": open("file.h5", "rb")} # Decommentare se in futuro vorrai aggiungere l'HDF5
    )

    if launch_response.status_code not in [200, 201]:
        print(f"❌ Errore nel lancio: {launch_response.text}")
        return

    sim_data = launch_response.json()
    sim_id = sim_data.get("simulation_id")
    print(f"✅ Simulazione avviata con successo! Job ID: {sim_id}")

    # ==========================================
    # 5. POLLING (OPZIONALE)
    # ==========================================
    print("⏳ Attesa del completamento dell'integrazione numerica...")
    while True:
        status_resp = requests.get(f"{BASE_URL}/simulations/{sim_id}/status", headers=headers)
        if status_resp.status_code == 200:
            status_data = status_resp.json()
            current_status = status_data.get("status")
            progress = status_data.get("progress", 0)
            
            print(f"   Stato: {current_status} - Progresso: {progress}%", end="\r")
            
            if current_status in ["COMPLETED", "FAILED", "ABORTED"]:
                print(f"\n🎯 Simulazione Terminata con stato finale: {current_status}")
                break
        else:
            print(f"\n⚠️ Errore durante il polling: {status_resp.text}")
            break
            
        time.sleep(2) # Polling ogni 2 secondi come nel frontend

if __name__ == "__main__":
    main()