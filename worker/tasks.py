import gc
import importlib
import io
import json
import random
import logging
import time
import numpy as np
from celery import Task
from sqlalchemy import select
from worker.celery_app import celery_app
from backend.api.deps import SessionLocal
from backend.models import Simulation, SimulationStatus, Network
from backend.services.minio_client import minio_service
import zipfile
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

logger = logging.getLogger(__name__)

ABORT_CHECK_INTERVAL_S = 2.0


class SimulationAborted(Exception):
    """La simulazione è stata interrotta (o eliminata) mentre il worker la eseguiva."""


def _is_aborted(simulation_id: int) -> bool:
    # Sessione dedicata: quella del task è dentro una transazione REPEATABLE READ
    # e non vedrebbe lo stato scritto dall'API.
    with SessionLocal() as session:
        status = session.scalar(select(Simulation.status).where(Simulation.id == simulation_id))
    return status is None or status == SimulationStatus.ABORTED


BUILTIN_EXPERIMENTS = {
    "decision_making": ("worker.networks.decision_making", "run_decision_making_experiment"),
    "cerebellum_conditioning": ("worker.networks.cerebellum_conditioning", "run_cerebellum_conditioning"),
    "cerebellum_msi_race": ("worker.networks.cerebellum_msi_race", "run_cerebellum_msi_race"),
}

NEST_CONN_KEYS = {"indegree", "outdegree", "p", "mask", "kernel", "allow_autapses", "allow_multapses"}

# Custom NESTML-compiled models hide internal parameters from GetDefaults().
# Parameters like g_leak, tau_exc, I_e must be passed raw without key-filtering.
CUSTOM_NESTML_MODELS = {
    "eglif_cond_alpha_multisyn",
    "eglif_pc_nestml",
    "eglif_mli",
    "eglif_io_nestml",
    "eglif_dcnp",
}

def sanitize_nest_params(params: dict) -> dict:
    import nest
    sanitized = {}
    for k, v in params.items():
        if isinstance(v, dict) and "distribution" in v:
            dist = v["distribution"]
            if dist == "uniform":
                sanitized[k] = nest.random.uniform(min=float(v.get("low", 0.0)), max=float(v.get("high", 1.0)))
            elif dist == "normal":
                sanitized[k] = nest.random.normal(mean=float(v.get("mean", 0.0)), std=float(v.get("std", 1.0)))
            else:
                logger.warning(f"Distribuzione {dist} non supportata, parametro {k} ignorato.")
            continue
            
        if k == "spike_times" and isinstance(v, list):
            clean_times = sorted(list(set([float(x) for x in v if float(x) > 0.0])))
            sanitized[k] = clean_times
            continue
            
        float_keys = {"start", "stop", "rate", "weight", "delay", "A_plus", "A_minus", "V_m", "V_th", "E_L", "C_m", "tau_m", "t_ref"}
        if k in float_keys and isinstance(v, (int, float)):
            sanitized[k] = float(v)
            continue
            
        sanitized[k] = v
    return sanitized

def create_poisson_spikes_rounded(n_sources: int, rate: float, duration: float) -> list:
    if rate <= 0 or duration <= 0: return [[] for _ in range(n_sources)]
    spike_trains = []
    mean_isi = 1000.0 / rate
    for _ in range(n_sources):
        t = 0.0
        spikes = []
        while True:
            isi = random.expovariate(1.0 / mean_isi)
            t += isi
            if t >= duration: break
            rounded_t = round(t, 1)
            if rounded_t > 0.0: spikes.append(rounded_t)
        spike_trains.append(sorted(list(set(spikes))))
    return spike_trains

def apply_trial_logic_v2(raw_spikes_list: list, trial_windows: list, trial_sequence: list, device_id: str) -> list:
    """Filter pre-generated Poisson spikes to only active stimulus windows.
    Uses explicit per-trial windows to support variable ITI and stimulus_duration_ms."""
    filtered_trains = []
    for raw_spikes in raw_spikes_list:
        valid_spikes = []
        for spike in raw_spikes:
            for t_idx, win in enumerate(trial_windows):
                if win["stim_start"] < spike <= win["stim_end"]:
                    if device_id in trial_sequence[t_idx]:
                        valid_spikes.append(spike)
                    break
        filtered_trains.append(valid_spikes)
    return filtered_trains

@celery_app.task(bind=True, name="worker.tasks.run_simulation_task")
def run_simulation_task(
    self: Task, 
    simulation_id: int, 
    duration_ms: float = 1000.0, 
    experiment_params_str: str = "{}"
) -> dict:
    
    db = SessionLocal()
    try:
        try:
            exp_params = json.loads(experiment_params_str)
        except Exception:
            exp_params = {}

        simulation = db.query(Simulation).filter(Simulation.id == simulation_id).first()
        if not simulation:
            return {"error": "Simulation not found in DB"}

        network = db.query(Network).filter(Network.id == simulation.network_id).first()
        if not network:
            return {"error": "Network not found in DB"}

        if simulation.status == SimulationStatus.ABORTED:
            return {"status": "ABORTED"}

        simulation.status = SimulationStatus.RUNNING
        db.add(simulation)
        db.commit()

        base_path = f"results/{simulation.owner_id}/sim_{simulation_id}"
        last_abort_check = time.monotonic()

        def _progress(pct, phase):
            # Il pool "solo" di Celery non può revocare un task in corso: l'interruzione
            # è cooperativa, il worker rilegge lo stato a ogni avanzamento.
            nonlocal last_abort_check
            now = time.monotonic()
            if now - last_abort_check >= ABORT_CHECK_INTERVAL_S:
                last_abort_check = now
                if _is_aborted(simulation_id):
                    raise SimulationAborted()
            self.update_state(state="PROGRESS", meta={"current": int(pct), "total": 100, "phase": phase})

        def _complete():
            if _is_aborted(simulation_id):
                raise SimulationAborted()
            simulation.results_path = base_path
            simulation.status = SimulationStatus.COMPLETED
            db.add(simulation)
            db.commit()
            logger.info(f"Simulazione {simulation_id} completata.")
            return {"status": "COMPLETED"}

        # Gli esperimenti built-in non passano dal contratto generico
        # popolazioni/proiezioni: costruiscono la propria rete NEST e la propria analisi.
        network_params = (network.definition.get("params", {}) or {})
        builtin = exp_params.get("builtin") or network_params.get("builtin")
        if builtin in BUILTIN_EXPERIMENTS:
            module_name, function_name = BUILTIN_EXPERIMENTS[builtin]
            run_experiment = getattr(importlib.import_module(module_name), function_name)
            run_experiment(
                self,
                {
                    "owner_id": simulation.owner_id,
                    "sim_id": simulation_id,
                    "network_definition": network.definition,
                },
                exp_params,
                minio_service,
                _progress,
            )
            return _complete()

        import nest
        nest.ResetKernel()
        # Consolidated kernel init: local_num_threads locked to 6 to prevent
        # CPU thread contention; resolution read from user params (default 0.1ms).
        kernel_resolution = float(exp_params.get("resolution", 0.1))
        # Decimal places of the resolution (0.1 -> 1); used to snap all
        # simulate durations onto the kernel grid and avoid float artefacts.
        _res_ndec = len(str(kernel_resolution).split(".")[1]) if "." in str(kernel_resolution) else 0
        nest.SetKernelStatus({
            "local_num_threads": 6,
            "resolution": kernel_resolution,
            "dict_miss_is_error": False,
            "print_time": True,
        })

        # CerebNEST may compile as "cerebmodule" (nest_3_8 branch) or
        # "cerebellar_module" depending on build config — try both.
        for _module_name in ("cerebellar_module", "cerebmodule"):
            try:
                nest.Install(_module_name)
                logger.info(f"NEST module '{_module_name}' caricato.")
                break
            except Exception:
                pass

        # --- PRE-CALCOLO SCENEGGIATURA TRIAL ---
        protocol = exp_params.get("protocol", {})
        trial_sequence = []          # active device IDs per trial
        trial_sequence_labels = []   # condition_label string per trial (e.g. "V", "A", "AV")
        trial_windows = []           # {stim_start, stim_end, trial_end, iti} per trial
        total_time = duration_ms

        if protocol:
            num_trials = int(protocol.get("num_trials", 1))
            trial_duration = float(protocol.get("trial_duration_ms", 1000.0))
            iti_ms = float(protocol.get("iti_ms", 0.0))
            iti_range = protocol.get("iti_range_ms", None)  # [min_ms, max_ms] for random ITI
            # stimulus_duration_ms: how long devices are ON per trial.
            # Defaults to full trial_duration for backward-compat.
            stimulus_duration_ms = float(protocol.get("stimulus_duration_ms", trial_duration))
            stimuli_pool = protocol.get("stimuli_pool", [])

            t_cursor = 0.0
            for _ in range(num_trials):
                # Pick a pool entry according to weights
                active_devs = []
                condition_label = ""
                if stimuli_pool:
                    weights = [pool.get("weight", 1.0) for pool in stimuli_pool]
                    chosen = random.choices(stimuli_pool, weights=weights, k=1)[0]
                    active_devs = chosen.get("devices", [])
                    condition_label = chosen.get("condition_label", "")
                trial_sequence.append(active_devs)
                trial_sequence_labels.append(condition_label)

                # Per-trial ITI: uniform sample if range given, otherwise fixed.
                # Quantize to the kernel resolution grid so every nest.Simulate()
                # call is an exact multiple of the resolution (NEST requirement).
                if iti_range and len(iti_range) == 2:
                    trial_iti = round(random.uniform(float(iti_range[0]), float(iti_range[1])), _res_ndec)
                else:
                    trial_iti = round(iti_ms, _res_ndec)

                trial_windows.append({
                    "stim_start": round(t_cursor, _res_ndec),
                    "stim_end": round(t_cursor + stimulus_duration_ms, _res_ndec),
                    "trial_end": round(t_cursor + trial_duration, _res_ndec),
                    "iti": trial_iti,
                })
                t_cursor = round(t_cursor + trial_duration + trial_iti, _res_ndec)

            total_time = t_cursor
        else:
            phases = exp_params.get("phases", {})
            train_time = float(phases.get("train_duration_ms", duration_ms))
            test_time = float(phases.get("test_duration_ms", 0.0))
            total_time = train_time + test_time if (train_time + test_time) > 0 else duration_ms

        topology = network.definition.get("topology", {})
        populations_data = topology.get("populations", [])
        projections_data = topology.get("projections", [])

        pop_nodes_map = {}      
        spike_recorders = {}    

        # FASE 3: CREAZIONE POPOLAZIONI E REGISTRATORI
        logger.info(f"Creazione di {len(populations_data)} popolazioni...")
        for pop in populations_data:
            pop_id = pop["id"]
            size = pop["size"]
            model = pop["neuron_model"]
            
            raw_params = pop.get("params", {})
            safe_params = sanitize_nest_params(raw_params)

            # Custom NESTML models hide internal params from GetDefaults().
            # Pass them raw to avoid silently dropping g_leak, tau_exc, I_e, etc.
            if model in CUSTOM_NESTML_MODELS:
                filtered_params = safe_params
            else:
                try:
                    valid_neuron_keys = nest.GetDefaults(model).keys()
                    filtered_params = {k: v for k, v in safe_params.items() if k in valid_neuron_keys}
                except Exception:
                    filtered_params = safe_params

            try:
                nodes = nest.Create(model, size, params=filtered_params)
            except Exception as e:
                logger.error(f"Errore creazione {model}: {e}")
                raise
                
            pop_nodes_map[pop_id] = nodes

            is_generator = "generator" in model.lower() or "stimulus" in model.lower()
            if not is_generator:
                MAX_RECORDED_NEURONS = 250
                recorded_nodes = nodes[:MAX_RECORDED_NEURONS] if size > MAX_RECORDED_NEURONS else nodes
                recorder = nest.Create("spike_recorder")
                nest.Connect(recorded_nodes, recorder)
                spike_recorders[pop_id] = recorder

        # FASE 4: CREAZIONE PROIEZIONI BIOLOGICHE
        logger.info(f"Connessione di {len(projections_data)} proiezioni interne...")
        for proj in projections_data:
            source_id = proj["source"]
            target_id = proj["target"]
            
            if source_id not in pop_nodes_map or target_id not in pop_nodes_map:
                continue

            source_nodes = pop_nodes_map[source_id]
            target_nodes = pop_nodes_map[target_id]
            
            raw_params = proj.get("params", {})
            safe_raw_params = sanitize_nest_params(raw_params)
            
            rule = proj.get("rule", "all_to_all")
            conn_spec = {"rule": rule}
            syn_spec = safe_raw_params.copy()
            
            for conn_param in NEST_CONN_KEYS:
                if conn_param in syn_spec:
                    val = syn_spec.pop(conn_param)
                    conn_spec[conn_param] = int(float(val)) if conn_param in ["indegree", "outdegree"] else val
            
            syn_spec["synapse_model"] = proj.get("synapse_model", "static_synapse")

            try:
                target_model_name = nest.GetStatus(target_nodes)[0]["model"]
                available_receptors = nest.GetDefaults(target_model_name).get("receptor_types", {})
            except Exception:
                available_receptors = {}

            if available_receptors and "receptor_type" not in syn_spec:
                syn_spec["receptor_type"] = min(available_receptors.values())
            elif "receptor_type" in syn_spec and available_receptors:
                # Only validate when we know the target model's receptor types.
                # NESTML custom models return empty dict → keep the specified value.
                if int(syn_spec["receptor_type"]) not in set(available_receptors.values()):
                    del syn_spec["receptor_type"]

            try:
                nest.Connect(source_nodes, target_nodes, conn_spec=conn_spec, syn_spec=syn_spec)
            except Exception as e:
                logger.error(f"ERRORE DI CONNESSIONE DA {source_id} a {target_id} ({rule}): {e}")
                raise

        # FASE 4.5: CREAZIONE E CONNESSIONE STIMOLI A RUNTIME
        runtime_inputs = exp_params.get("inputs", {})
        input_devices = runtime_inputs.get("devices", [])
        input_connections = runtime_inputs.get("connections", [])

        device_nodes_map = {}
        device_original_params = {}

        if input_devices:
            logger.info(f"Creazione di {len(input_devices)} dispositivi di input a runtime...")
            for dev in input_devices:
                dev_id = dev["id"]
                model = dev["model"]
                dev_params = dev.get("params", {})
                size = dev.get("size", 1) 
                
                if model == "legacy_sensory_stimulus":
                    rate = float(dev_params.get("rate", 20.0))
                    n_sources = int(dev_params.get("n_sources", 1))
                    
                    raw_spikes_list = create_poisson_spikes_rounded(n_sources, rate, total_time)
                    
                    if protocol:
                        filtered_trains = apply_trial_logic_v2(raw_spikes_list, trial_windows, trial_sequence, dev_id)
                    else:
                        filtered_trains = raw_spikes_list
                        
                    nodes = nest.Create("spike_generator", n_sources)
                    
                    for idx in range(len(nodes)):
                        if idx < len(filtered_trains) and len(filtered_trains[idx]) > 0:
                            nest.SetStatus(nodes[idx:idx+1], {"spike_times": filtered_trains[idx]})
                        
                    device_nodes_map[dev_id] = nodes
                    
                else:
                    safe_dev_params = sanitize_nest_params(dev_params)
                    device_original_params[dev_id] = safe_dev_params
                    nodes = nest.Create(model, size, params=safe_dev_params)
                    device_nodes_map[dev_id] = nodes

            logger.info(f"Connessione di {len(input_connections)} proiezioni di input...")
            for conn in input_connections:
                source_id = conn["source"]
                target_id = conn["target"]

                if source_id not in device_nodes_map or target_id not in pop_nodes_map:
                    continue

                source_nodes = device_nodes_map[source_id]
                target_nodes = pop_nodes_map[target_id]
                
                raw_params = conn.get("params", {})
                safe_raw_params = sanitize_nest_params(raw_params)
                
                rule = conn.get("rule", "all_to_all")
                conn_spec = {"rule": rule}
                syn_spec = safe_raw_params.copy()

                for conn_param in NEST_CONN_KEYS:
                    if conn_param in syn_spec:
                        val = syn_spec.pop(conn_param)
                        conn_spec[conn_param] = int(float(val)) if conn_param in ["indegree", "outdegree"] else val

                syn_spec["synapse_model"] = conn.get("synapse_model", "static_synapse")

                try:
                    target_model_name = nest.GetStatus(target_nodes)[0]["model"]
                    available_receptors = nest.GetDefaults(target_model_name).get("receptor_types", {})
                except Exception:
                    available_receptors = {}

                if available_receptors and "receptor_type" not in syn_spec:
                    syn_spec["receptor_type"] = min(available_receptors.values())
                elif "receptor_type" in syn_spec and available_receptors:
                    if int(syn_spec["receptor_type"]) not in set(available_receptors.values()):
                        del syn_spec["receptor_type"]

                try:
                    nest.Connect(source_nodes, target_nodes, conn_spec=conn_spec, syn_spec=syn_spec)
                except Exception as e:
                    logger.error(f"ERRORE DI CONNESSIONE INPUT DA {source_id} a {target_id} ({rule}): {e}")
                    raise

        # FASE 5: ESECUZIONE SIMULAZIONE
        current_time_simulated = 0.0

        def toggle_devices(active_devices: list):
            for dev_id, nodes in device_nodes_map.items():
                if dev_id not in device_original_params: 
                    continue 
                try:
                    model = nest.GetStatus(nodes)[0]["model"]
                    if dev_id in active_devices:
                        orig_params = device_original_params.get(dev_id, {})
                        if "rate" in orig_params:
                            nest.SetStatus(nodes, {"rate": float(orig_params["rate"])})
                        elif "amplitude" in orig_params:
                            nest.SetStatus(nodes, {"amplitude": float(orig_params["amplitude"])})
                    else:
                        if "poisson_generator" in model:
                            nest.SetStatus(nodes, {"rate": 0.0})
                        elif "dc_generator" in model:
                            nest.SetStatus(nodes, {"amplitude": 0.0})
                except Exception as e:
                    logger.warning(f"Errore durante toggle device {dev_id}: {e}")

        def simulate_with_progress_and_gc(sim_time, phase_name):
            nonlocal current_time_simulated
            if sim_time <= 0: return
            
            chunk_dur = 500.0
            remaining_time = round(sim_time, _res_ndec)

            while remaining_time > 1e-9:
                current_chunk = round(min(chunk_dur, remaining_time), _res_ndec)
                nest.Simulate(current_chunk)

                remaining_time = round(remaining_time - current_chunk, _res_ndec)
                current_time_simulated += current_chunk
                
                _progress((current_time_simulated / total_time) * 100, phase_name)
                
                gc.collect()

        if protocol:
            logger.info(f"Avvio Protocollo: {len(trial_windows)} Trial ({total_time:.0f} ms totali)")

            for t_idx, win in enumerate(trial_windows):
                active_devs = trial_sequence[t_idx]

                # Stimulus window: devices ON for stimulus_duration_ms
                stim_dur = win["stim_end"] - win["stim_start"]
                if stim_dur > 0:
                    toggle_devices(active_devs)
                    simulate_with_progress_and_gc(stim_dur, f'STIM {t_idx+1}')

                # Response window: devices OFF, network integrates
                resp_dur = win["trial_end"] - win["stim_end"]
                if resp_dur > 0:
                    toggle_devices([])
                    simulate_with_progress_and_gc(resp_dur, f'RESP {t_idx+1}')

                # ITI: silence between trials
                if win["iti"] > 0:
                    simulate_with_progress_and_gc(win["iti"], f'ITI {t_idx+1}')
        else:
            phases = exp_params.get("phases", {})
            train_time = float(phases.get("train_duration_ms", duration_ms))
            test_time = float(phases.get("test_duration_ms", 0.0))
            disable_plasticity_in_test = phases.get("disable_plasticity_during_test", True)
            
            if train_time > 0:
                logger.info(f"Avvio fase di TRAINING per {train_time} ms...")
                simulate_with_progress_and_gc(train_time, 'TRAINING')

            if test_time > 0 and disable_plasticity_in_test:
                stdp_models = ["stdp_synapse_sinexp", "stdp_synapse_alpha", "stdp_synapse"]
                for sm in stdp_models:
                    try:
                        conns = nest.GetConnections(synapse_model=sm)
                        if len(conns) > 0:
                            defaults = nest.GetDefaults(sm)
                            zeros = {param: 0.0 for param in ["A_plus", "A_minus", "lambda", "alpha", "mu_plus", "mu_minus"] if param in defaults}
                            if zeros:
                                nest.SetStatus(conns, zeros)
                    except Exception:
                        pass

            if test_time > 0:
                logger.info(f"Avvio fase di TEST per {test_time} ms...")
                simulate_with_progress_and_gc(test_time, 'TEST')

        # FASE 6: RACCOLTA, PLOTTING E ACCURATEZZA
        logger.info("Estrazione dati, generazione grafici e upload...")
        
        simulation_results = {
            "metadata": {"simulation_id": simulation_id, "total_duration_ms": total_time},
            "spikes": {}
        }
        
        for pop_id, recorder in spike_recorders.items():
            events = nest.GetStatus(recorder, "events")[0]
            simulation_results["spikes"][pop_id] = {"senders": events["senders"].tolist(), "times": events["times"].tolist()}
            del events
            gc.collect()

        zip_path = f"{base_path}/graphs.zip"

        file_bytes = json.dumps(simulation_results).encode("utf-8")
        minio_service.upload_file(io.BytesIO(file_bytes), len(file_bytes), f"{base_path}/spikes.json", "application/json")
        del file_bytes
        gc.collect()

        # Apriamo lo zip_buf (Lo chiuderemo e upperemo alla FINE)
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            
            # 1. Grafici Standard
            for pop_id, data in simulation_results["spikes"].items():
                plt.figure(figsize=(8, 5))
                if data["times"]: plt.scatter(data["times"], data["senders"], s=2, color='#2563eb')
                if not protocol:
                    test_time = float(exp_params.get("phases", {}).get("test_duration_ms", 0.0))
                    train_time = float(exp_params.get("phases", {}).get("train_duration_ms", duration_ms))
                    if test_time > 0 and train_time > 0:
                        plt.axvline(x=train_time, color='r', linestyle='--', alpha=0.5, label='Inizio Test')
                plt.title(f"Raster Plot - {pop_id}")
                plt.xlabel("Tempo (ms)")
                plt.ylabel("ID Neurone")
                if not protocol and test_time > 0: plt.legend()
                
                raster_buf = io.BytesIO()
                plt.savefig(raster_buf, format='png', dpi=150, bbox_inches='tight')
                plt.close()
                raster_name = f"{pop_id}_raster.png"
                minio_service.upload_file(io.BytesIO(raster_buf.getvalue()), len(raster_buf.getvalue()), f"{base_path}/{raster_name}", "image/png")
                zf.writestr(raster_name, raster_buf.getvalue())
                del raster_buf

                plt.figure(figsize=(8, 5))
                if data["times"]: plt.hist(data["times"], bins=50, color='#7c3aed', alpha=0.7)
                if not protocol and train_time > 0 and test_time > 0:
                    plt.axvline(x=train_time, color='r', linestyle='--', alpha=0.5)
                plt.title(f"Firing Rate - {pop_id}")
                plt.xlabel("Tempo (ms)")
                plt.ylabel("Spike Count")
                
                hist_buf = io.BytesIO()
                plt.savefig(hist_buf, format='png', dpi=150, bbox_inches='tight')
                plt.close()
                hist_name = f"{pop_id}_histogram.png"
                minio_service.upload_file(io.BytesIO(hist_buf.getvalue()), len(hist_buf.getvalue()), f"{base_path}/{hist_name}", "image/png")
                zf.writestr(hist_name, hist_buf.getvalue())
                del hist_buf
                gc.collect()

            # 2. Analisi Differenziale e Accuratezza
            analysis_params = exp_params.get("analysis", {})
            diff_plots = analysis_params.get("differential_plots", [])
            decision_log = {"metrics": []}

            for plot_cfg in diff_plots:
                pop_a = plot_cfg.get("pop_a")
                pop_b = plot_cfg.get("pop_b")
                label = plot_cfg.get("label", "Differential Analysis")
                
                if pop_a in simulation_results["spikes"] and pop_b in simulation_results["spikes"]:
                    data_a = simulation_results["spikes"][pop_a]["times"]
                    data_b = simulation_results["spikes"][pop_b]["times"]
                    
                    # --- Generazione Grafico Differenziale ---
                    bins = np.arange(0, total_time + 50.0, 50.0)
                    hist_a, _ = np.histogram(data_a, bins=bins)
                    hist_b, _ = np.histogram(data_b, bins=bins)
                    diff_rate = (hist_a - hist_b) / (50.0 / 1000.0)
                    
                    plt.figure(figsize=(10, 4))
                    plt.plot(bins[:-1], diff_rate, color='green' if "DCN" in label else 'purple')
                    plt.axhline(0, color='black', lw=1)
                    plt.title(f"{label}: {pop_a} vs {pop_b}")
                    plt.ylabel("Delta Rate (Hz)")
                    plt.xlabel("Tempo (ms)")
                    
                    diff_buf = io.BytesIO()
                    plt.savefig(diff_buf, format='png', dpi=150)
                    plt.close()
                    diff_name = f"diff_{pop_a}_{pop_b}.png"
                    minio_service.upload_file(io.BytesIO(diff_buf.getvalue()), len(diff_buf.getvalue()), f"{base_path}/{diff_name}", "image/png")
                    zf.writestr(diff_name, diff_buf.getvalue())
                    del diff_buf
                    
                    # --- Calcolo Decisioni e Accuratezza (Solo per protocollo a trial) ---
                    if protocol:
                        comparison_results = []
                        correct_trials = 0
                        valid_trials = 0

                        for t_idx, win in enumerate(trial_windows):
                            t_start = win["stim_start"]
                            t_end = win["trial_end"]
                            active_devs = trial_sequence[t_idx]
                            condition_label = trial_sequence_labels[t_idx]

                            # Use condition_label if available; fall back to device naming (_A/_B)
                            if condition_label:
                                cond_lower = condition_label.lower()
                                if pop_a.lower() in cond_lower:
                                    expected_winner = pop_a
                                elif pop_b.lower() in cond_lower:
                                    expected_winner = pop_b
                                elif not active_devs:
                                    expected_winner = "TIE"
                                else:
                                    expected_winner = "TIE"
                            else:
                                expected_winner = "TIE"
                                if any("_A" in dev for dev in active_devs): expected_winner = pop_a
                                elif any("_B" in dev for dev in active_devs): expected_winner = pop_b

                            spikes_a = sum(1 for spike in data_a if t_start <= spike <= t_end)
                            spikes_b = sum(1 for spike in data_b if t_start <= spike <= t_end)
                            net_evidence = spikes_a - spikes_b

                            if net_evidence > 10: actual_winner = pop_a
                            elif net_evidence < -10: actual_winner = pop_b
                            else: actual_winner = "TIE"

                            is_correct = None
                            if expected_winner != "TIE":
                                valid_trials += 1
                                is_correct = (actual_winner == expected_winner)
                                if is_correct: correct_trials += 1

                            comparison_results.append({
                                "trial": t_idx + 1,
                                "active_stimuli": active_devs,
                                "condition_label": condition_label,
                                "expected_winner": expected_winner,
                                "actual_winner": actual_winner,
                                "is_correct": is_correct,
                                "net_evidence": net_evidence,
                            })

                        accuracy_percent = (correct_trials / valid_trials * 100) if valid_trials > 0 else 0.0
                        decision_log["metrics"].append({
                            "comparison": f"{pop_a} vs {pop_b}",
                            "accuracy_percent": round(accuracy_percent, 2),
                            "total_valid_trials": valid_trials,
                            "correct_trials": correct_trials,
                            "trial_details": comparison_results,
                        })
            
            # --- Upload del JSON delle Metriche (dentro Minio e nello ZIP) ---
            if protocol and diff_plots:
                decision_bytes = json.dumps(decision_log, indent=2).encode("utf-8")
                minio_service.upload_file(io.BytesIO(decision_bytes), len(decision_bytes), f"{base_path}/accuracy_metrics.json", "application/json")
                zf.writestr("accuracy_metrics.json", decision_bytes)
                del decision_bytes
                gc.collect()

            # --- RACE MODEL INEQUALITY ANALYSIS (Miller 1982) ---
            # Requires: condition_label in pool entries ("V", "A", "AV"),
            # and analysis.race_model = {enabled: true, populations: [...]}
            race_model_cfg = analysis_params.get("race_model", {})
            if race_model_cfg.get("enabled") and protocol and trial_windows:
                rmi_populations = race_model_cfg.get("populations", [])
                rmi_results = []

                for rmi_pop in rmi_populations:
                    if rmi_pop not in simulation_results["spikes"]:
                        continue

                    pop_spikes = np.array(simulation_results["spikes"][rmi_pop]["times"])

                    # Per-trial first-spike latency, grouped by condition_label
                    condition_latencies: dict = {}
                    for t_idx, win in enumerate(trial_windows):
                        cond = trial_sequence_labels[t_idx]
                        if not cond:
                            continue
                        t_start = win["stim_start"]
                        t_end = win["trial_end"]
                        mask = (pop_spikes >= t_start) & (pop_spikes <= t_end)
                        trial_spikes_rel = pop_spikes[mask] - t_start
                        latency = float(trial_spikes_rel.min()) if len(trial_spikes_rel) > 0 else None
                        condition_latencies.setdefault(cond, [])
                        if latency is not None:
                            condition_latencies[cond].append(latency)

                    v_lat = condition_latencies.get("V", [])
                    a_lat = condition_latencies.get("A", [])
                    av_lat = condition_latencies.get("AV", [])

                    if v_lat and a_lat and av_lat:
                        all_lat = v_lat + a_lat + av_lat
                        t_max = float(max(all_lat))
                        time_pts = np.arange(0.0, t_max + 1.0, 1.0)

                        def ecdf(data: list, t_arr: np.ndarray) -> np.ndarray:
                            d = np.array(data)
                            return np.array([float(np.sum(d <= t)) / len(d) for t in t_arr])

                        cdf_v = ecdf(v_lat, time_pts)
                        cdf_a = ecdf(a_lat, time_pts)
                        cdf_av = ecdf(av_lat, time_pts)
                        rmi_bound = cdf_v + cdf_a - cdf_v * cdf_a
                        rmi_violation = cdf_av - rmi_bound

                        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

                        ax1.plot(time_pts, cdf_v, 'b-', lw=2, label=f'V (n={len(v_lat)})')
                        ax1.plot(time_pts, cdf_a, 'r-', lw=2, label=f'A (n={len(a_lat)})')
                        ax1.plot(time_pts, cdf_av, 'g-', lw=2.5, label=f'AV (n={len(av_lat)})')
                        ax1.plot(time_pts, rmi_bound, 'k--', lw=1.5, alpha=0.8, label='Race Bound (V+A−V·A)')
                        ax1.fill_between(time_pts, rmi_bound, cdf_av, where=(cdf_av > rmi_bound), alpha=0.2, color='green', label='RMI Violation')
                        ax1.set_xlabel('First-Spike Latency (ms)')
                        ax1.set_ylabel('Cumulative Probability')
                        ax1.set_title(f'Race Model Inequality — {rmi_pop}')
                        ax1.legend(fontsize=9)
                        ax1.grid(True, alpha=0.3)
                        ax1.set_ylim(-0.05, 1.05)

                        ax2.plot(time_pts, rmi_violation, color='#16a34a', lw=2, label='AV − Race Bound')
                        ax2.axhline(0, color='black', lw=1, ls='--')
                        ax2.fill_between(time_pts, 0, rmi_violation, where=(rmi_violation > 0), alpha=0.3, color='green', label='Facilitation (MSI)')
                        ax2.fill_between(time_pts, rmi_violation, 0, where=(rmi_violation < 0), alpha=0.3, color='red', label='Inhibition')
                        ax2.set_xlabel('First-Spike Latency (ms)')
                        ax2.set_ylabel('RMI Violation')
                        ax2.set_title('RMI Violation Curve')
                        ax2.legend(fontsize=9)
                        ax2.grid(True, alpha=0.3)

                        plt.tight_layout()
                        rmi_buf = io.BytesIO()
                        plt.savefig(rmi_buf, format='png', dpi=150, bbox_inches='tight')
                        plt.close()

                        rmi_img_name = f"rmi_{rmi_pop}.png"
                        minio_service.upload_file(io.BytesIO(rmi_buf.getvalue()), len(rmi_buf.getvalue()), f"{base_path}/{rmi_img_name}", "image/png")
                        zf.writestr(rmi_img_name, rmi_buf.getvalue())
                        del rmi_buf

                        rmi_results.append({
                            "population": rmi_pop,
                            "n_V": len(v_lat),
                            "n_A": len(a_lat),
                            "n_AV": len(av_lat),
                            "max_rmi_violation": round(float(np.max(rmi_violation)), 4),
                            "has_facilitation": bool(np.any(rmi_violation > 0.05)),
                        })
                        gc.collect()

                if rmi_results:
                    rmi_json = json.dumps({"race_model": rmi_results}, indent=2).encode("utf-8")
                    minio_service.upload_file(io.BytesIO(rmi_json), len(rmi_json), f"{base_path}/race_model.json", "application/json")
                    zf.writestr("race_model.json", rmi_json)
                    del rmi_json

            # --- OUTPUT POPULATION RESPONSE ANALYSIS + RESPONSE-TIME CDF ---
            # For each differential pair (e.g. DCN_A vs DCN_B) we show how the
            # output populations respond to each stimulus condition and compute
            # the response-time CDF. The "response" is the first threshold
            # crossing of |rate_a - rate_b| within a trial (legacy cerebellum
            # method) — robust to tonic baseline because the two competing
            # populations cancel until one of them wins. The sign of the
            # differential tells which population (side) responded.
            response_cfg = analysis_params.get("response_cdf", {})
            do_response = bool(protocol and diff_plots and response_cfg.get("enabled", True))
            response_log = {"populations": []}
            if do_response:
                rt_bin = float(response_cfg.get("bin_size", 5.0))
                rt_threshold = float(response_cfg.get("threshold", 15.0))

                # monitored neuron counts (recorders capped at MAX_RECORDED_NEURONS = 250)
                pop_size_map = {p["id"]: min(int(p.get("size", 1)), 250) for p in populations_data}

                def _ma_rate(times, n_mon):
                    n_mon = max(1, n_mon)
                    edges = np.arange(0.0, total_time + rt_bin, rt_bin)
                    counts, _ = np.histogram(np.asarray(times, dtype=float), bins=edges)
                    rate = counts * 1000.0 / (rt_bin * n_mon)
                    w = 10
                    pad = w // 2
                    padded = np.concatenate([np.zeros(pad), rate, np.zeros(pad)])
                    ma = np.convolve(padded, np.ones(w) / w, mode="same")[pad:pad + len(rate)]
                    return edges[:-1], ma

                # Stable color per stimulus condition
                uniq_conditions = []
                for lbl in trial_sequence_labels:
                    key = lbl if lbl else "—"
                    if key not in uniq_conditions:
                        uniq_conditions.append(key)
                cmap = plt.get_cmap("tab10")
                cond_color = {c: cmap(i % 10) for i, c in enumerate(uniq_conditions)}

                for plot_cfg in diff_plots:
                    pop_a = plot_cfg.get("pop_a")
                    pop_b = plot_cfg.get("pop_b")
                    label = plot_cfg.get("label", f"{pop_a} vs {pop_b}")
                    if pop_a not in simulation_results["spikes"] or pop_b not in simulation_results["spikes"]:
                        continue

                    centers, ma_a = _ma_rate(simulation_results["spikes"][pop_a]["times"], pop_size_map.get(pop_a, 1))
                    _, ma_b = _ma_rate(simulation_results["spikes"][pop_b]["times"], pop_size_map.get(pop_b, 1))
                    signed = ma_a - ma_b

                    per_cond_rt: dict = {}
                    trial_rows = []
                    for t_idx, win in enumerate(trial_windows):
                        cond = trial_sequence_labels[t_idx] or "—"
                        t0 = win["stim_start"]
                        t1 = win["trial_end"]
                        mask = (centers >= t0) & (centers <= t1)
                        seg_t = centers[mask]
                        seg_d = signed[mask]
                        cross = np.where(np.abs(seg_d) >= rt_threshold)[0]
                        if len(cross):
                            rt = float(seg_t[cross[0]] - t0)
                            winner = pop_a if seg_d[cross[0]] > 0 else pop_b
                        else:
                            rt = None
                            winner = "none"
                        per_cond_rt.setdefault(cond, [])
                        if rt is not None:
                            per_cond_rt[cond].append(rt)
                        trial_rows.append({
                            "trial": t_idx + 1,
                            "condition": cond,
                            "active_stimuli": trial_sequence[t_idx],
                            "response_time_ms": round(rt, 1) if rt is not None else None,
                            "winner": winner,
                        })

                    # Activation plot: each population's rate, trial windows shaded by condition
                    fig = plt.figure(figsize=(12, 4.5))
                    ax = plt.gca()
                    seen = set()
                    for t_idx, win in enumerate(trial_windows):
                        cond = trial_sequence_labels[t_idx] or "—"
                        col = cond_color.get(cond, (0.8, 0.8, 0.8, 1))
                        lbl = f"stim: {cond}" if cond not in seen else None
                        seen.add(cond)
                        ax.axvspan(win["stim_start"], win["stim_end"], color=col, alpha=0.15, label=lbl)
                    ax.plot(centers, ma_a, color="#2563eb", lw=1.3, label=f"{pop_a} rate")
                    ax.plot(centers, ma_b, color="#dc2626", lw=1.3, label=f"{pop_b} rate")
                    ax.set_xlabel("Time (ms)")
                    ax.set_ylabel("Firing rate (Hz)")
                    ax.set_title(f"Output activation by stimulus condition — {label}")
                    ax.legend(fontsize=8, ncol=3, loc="upper right")
                    ax.grid(True, alpha=0.25)
                    abuf = io.BytesIO()
                    plt.savefig(abuf, format="png", dpi=150, bbox_inches="tight")
                    plt.close()
                    aname = f"activation_{pop_a}_{pop_b}.png"
                    minio_service.upload_file(io.BytesIO(abuf.getvalue()), len(abuf.getvalue()), f"{base_path}/{aname}", "image/png")
                    zf.writestr(aname, abuf.getvalue())
                    del abuf

                    # Response-time CDF, one curve per stimulus condition (legacy method)
                    trial_dur = float(trial_windows[0]["trial_end"] - trial_windows[0]["stim_start"]) if trial_windows else 600.0
                    fig = plt.figure(figsize=(8, 5))
                    any_curve = False
                    for cond, rts in per_cond_rt.items():
                        if not rts:
                            continue
                        counts, edges = np.histogram(rts, bins=10)
                        s = counts.sum()
                        if s == 0:
                            continue
                        cdf = np.cumsum(counts / s)
                        plt.plot(edges[1:], cdf, "--o", color=cond_color.get(cond), label=f"{cond} (n={len(rts)})")
                        any_curve = True
                    plt.xlim(0, max(100.0, min(600.0, trial_dur)))
                    plt.ylim(0, 1.1)
                    plt.xlabel("Response time (ms)")
                    plt.ylabel("Cumulative probability")
                    plt.title(f"Response-time CDF — {label}")
                    if any_curve:
                        plt.legend(fontsize=9)
                    plt.grid(alpha=0.3)
                    cbuf = io.BytesIO()
                    plt.savefig(cbuf, format="png", dpi=150, bbox_inches="tight")
                    plt.close()
                    cname = f"cdf_{pop_a}_{pop_b}.png"
                    minio_service.upload_file(io.BytesIO(cbuf.getvalue()), len(cbuf.getvalue()), f"{base_path}/{cname}", "image/png")
                    zf.writestr(cname, cbuf.getvalue())
                    del cbuf

                    response_log["populations"].append({
                        "label": label,
                        "pop_a": pop_a,
                        "pop_b": pop_b,
                        "threshold_hz": rt_threshold,
                        "median_by_condition": {k: round(float(np.median(v)), 1) for k, v in per_cond_rt.items() if v},
                        "count_by_condition": {k: len(v) for k, v in per_cond_rt.items()},
                        "response_times_by_condition": {k: [round(x, 1) for x in v] for k, v in per_cond_rt.items()},
                        "trials": trial_rows,
                    })
                    gc.collect()

                if response_log["populations"]:
                    rbytes = json.dumps(response_log, indent=2).encode("utf-8")
                    minio_service.upload_file(io.BytesIO(rbytes), len(rbytes), f"{base_path}/response_times.json", "application/json")
                    zf.writestr("response_times.json", rbytes)
                    del rbytes
                    gc.collect()

        # CHIUSURA E UPLOAD DELLO ZIP FINALE (Ora include i grafici diff e i JSON!)
        zip_buf.seek(0)
        minio_service.upload_file(io.BytesIO(zip_buf.getvalue()), len(zip_buf.getvalue()), zip_path, "application/zip")

        return _complete()
        
    except SimulationAborted:
        db.rollback()
        minio_service.delete_directory(base_path)
        logger.info(f"Simulazione {simulation_id} interrotta dall'utente.")
        return {"status": "ABORTED"}

    except Exception as e:
        db.rollback()
        simulation = db.query(Simulation).filter(Simulation.id == simulation_id).first()
        if simulation:
            simulation.status = SimulationStatus.FAILED
            db.add(simulation)
            db.commit()
        logger.error(f"Errore critico durante la simulazione {simulation_id}: {e}")
        raise
        
    finally:
        db.close()