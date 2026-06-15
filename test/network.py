import requests
import json

# ==========================================
# 1. CONFIGURAZIONE AMBIENTE
# ==========================================
BASE_URL = "http://localhost:8000/api/v1"
USERNAME = "test@test.it"
PASSWORD = "test"

def main():
    print("🚀 Inizio automazione Creazione Rete MuSiN...")

    # ==========================================
    # 2. LOGIN & AUTHENTICATION
    # ==========================================
    print("🔑 Autenticazione in corso...")
    auth_data = {
        "username": USERNAME,
        "password": PASSWORD
    }
    
    # Effettua il login per ottenere il JWT Token
    auth_response = requests.post(f"{BASE_URL}/auth/login", data=auth_data)
    
    if auth_response.status_code != 200:
        print(f"❌ Errore di Login: {auth_response.text}")
        return

    token = auth_response.json().get("access_token")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    print("✅ Login effettuato. Token ottenuto.")

    # ==========================================
    # 3. DEFINIZIONE DELLA RETE (TOPOLOGY PAYLOAD)
    # ==========================================
    # Qui traduciamo il tuo vecchio codice Python in JSON puro
    
    network_payload = {
        "name": "Cerebellum - Architettura e Biologia Originale",
        "description": "GR configurati, PC/IO/DCN lasciati ai loro default pacemaker biologici.",
        "nodes_count": 240,
        "edges_count": 5000,
        "topology": {
            "populations": [
                {"id": "GR", "size": 200, "neuron_model": "iaf_cond_exp", "params": {"t_ref": 1.0, "C_m": 2.0, "V_th": -40.0, "V_reset": -70.0, "E_L": -70.0, "g_L": 0.2, "tau_syn_ex": 0.5, "tau_syn_in": 10.0}},
                
                # Lasciamo vuoti i parametri EGLIF: useranno i default esatti del C++
                {"id": "PC_A", "size": 10, "neuron_model": "eglif_pc_nestml", "params": {}},
                {"id": "PC_B", "size": 10, "neuron_model": "eglif_pc_nestml", "params": {}},
                {"id": "IO_A", "size": 10, "neuron_model": "eglif_io_nestml", "params": {}},
                {"id": "IO_B", "size": 10, "neuron_model": "eglif_io_nestml", "params": {}},
                {"id": "DCN_A", "size": 5, "neuron_model": "eglif_dcnp", "params": {}},
                {"id": "DCN_B", "size": 5, "neuron_model": "eglif_dcnp", "params": {}}
            ],
            "projections": [
                {"source": "GR", "target": "PC_A", "rule": "fixed_indegree", "synapse_model": "stdp_synapse_sinexp", "params": {"indegree": 160, "weight": 4.0, "receptor_type": 1, "A_minus": 2.0e-2, "A_plus": 1.0e-3}},
                {"source": "GR", "target": "PC_B", "rule": "fixed_indegree", "synapse_model": "stdp_synapse_sinexp", "params": {"indegree": 160, "weight": 4.0, "receptor_type": 1, "A_minus": 2.0e-2, "A_plus": 1.0e-3}},
                {"source": "IO_A", "target": "PC_A", "rule": "one_to_one", "synapse_model": "static_synapse", "params": {"weight": 1.0, "receptor_type": 5}},
                {"source": "IO_B", "target": "PC_B", "rule": "one_to_one", "synapse_model": "static_synapse", "params": {"weight": 1.0, "receptor_type": 5}},
                {"source": "PC_A", "target": "DCN_A", "rule": "fixed_outdegree", "synapse_model": "static_synapse", "params": {"outdegree": 1, "weight": -10.0, "receptor_type": 3}},
                {"source": "PC_B", "target": "DCN_B", "rule": "fixed_outdegree", "synapse_model": "static_synapse", "params": {"outdegree": 1, "weight": -10.0, "receptor_type": 3}}
            ]
        }
    }

    # ==========================================
    # 4. CREAZIONE NEL DATABASE
    # ==========================================
    print("🧠 Creazione della rete nel database...")
    
    response = requests.post(
        f"{BASE_URL}/networks",
        headers=headers,
        json=network_payload
    )

    if response.status_code in [200, 201]:
        network_data = response.json()
        network_id = network_data.get("id")
        print(f"✅ Rete creata con successo! ID RETE: {network_id}")
        print("\n📝 PROSSIMO STEP: Copia questo ID RETE e incollalo nel tuo script di Simulazione come NETWORK_ID.")
    else:
        print(f"❌ Errore durante la creazione della rete: {response.status_code}")
        print(response.text)

if __name__ == "__main__":
    main()