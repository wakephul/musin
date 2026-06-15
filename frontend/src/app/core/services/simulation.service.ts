import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

export interface SimulationLaunchResponse {
  simulation_id: string;
}

export interface SimulationStatus {
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED';
  progress: number;
  message?: string;
  network_id?: string;
  experiment_params?: any;
}

export interface PopulationGraph {
  population_id: string;
  raster_url: string;
  histogram_url: string;
}

export interface DifferentialGraph {
  label: string;
  url: string;
}

export interface TrialDetail {
  trial: number;
  active_stimuli: string[];
  condition_label?: string;
  expected_winner: string;
  actual_winner: string;
  is_correct: boolean;
  net_evidence: number;
}

export interface AccuracyMetric {
  comparison: string;
  accuracy_percent: number;
  total_valid_trials: number;
  correct_trials: number;
  trial_details: TrialDetail[];
}

export interface AccuracyMetricsData {
  metrics: AccuracyMetric[];
}

export interface RaceModelResult {
  population: string;
  n_V: number;
  n_A: number;
  n_AV: number;
  max_rmi_violation: number;
  has_facilitation: boolean;
}

export interface RaceModelGraph {
  population: string;
  url: string;
}

export interface RaceModelData {
  race_model: RaceModelResult[];
}

export interface ExperimentGraph {
  label: string;
  url: string;
}

export interface ResponseGraph {
  kind: 'activation' | 'cdf';
  pair: string;
  url: string;
}

export interface SimulationResult {
  raw_file_url: string;
  graphs_zip_url: string;
  population_graphs: PopulationGraph[];
  network_id?: string;
  network_name?: string;
  duration_ms?: number;
  experiment_params?: any;
  differential_graphs?: DifferentialGraph[];
  accuracy_metrics?: AccuracyMetricsData;
  race_model_graphs?: RaceModelGraph[];
  race_model_data?: RaceModelData;
  experiment_graphs?: ExperimentGraph[];
  experiment_metrics?: any;
  response_graphs?: ResponseGraph[];
  response_analysis?: any;
}

// INTERFACCIA PER LO STORICO
export interface SimulationItem {
  id: string;
  network_id: string;
  status: string;
  created_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class SimulationService {
  private http = inject(HttpClient);
  private readonly API_URL = '/api/v1/simulations';

  launchSimulation(
    networkId: string,
    experimentParams: any, // Le durate ora sono qui dentro!
    stimulusFile?: File,
  ): Observable<SimulationLaunchResponse> {
    const formData = new FormData();
    formData.append('network_id', networkId);

    // Passiamo l'intero protocollo (fasi incluse) come JSON
    formData.append('params', JSON.stringify(experimentParams));

    if (stimulusFile) {
      formData.append('stimuli', stimulusFile);
    }
    return this.http.post<SimulationLaunchResponse>(
      `${this.API_URL}/launch`,
      formData,
    );
  }

  getStatus(simulationId: string): Observable<SimulationStatus> {
    return this.http.get<SimulationStatus>(
      `${this.API_URL}/${simulationId}/status`,
    );
  }

  abortSimulation(simulationId: string): Observable<void> {
    return this.http.post<void>(`${this.API_URL}/${simulationId}/abort`, {});
  }

  getResults(simulationId: string): Observable<SimulationResult> {
    return this.http.get<SimulationResult>(
      `${this.API_URL}/${simulationId}/results`,
    );
  }

  pollStatus(simulationId: string): Observable<SimulationStatus> {
    return timer(0, 2000).pipe(switchMap(() => this.getStatus(simulationId)));
  }

  getSimulations(
    skip: number = 0,
    limit: number = 100,
  ): Observable<SimulationItem[]> {
    return this.http.get<SimulationItem[]>(
      `${this.API_URL}?skip=${skip}&limit=${limit}`,
    );
  }

  deleteSimulation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }
}
