import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { EMPTY, Observable, throwError, timer } from 'rxjs';
import { catchError, switchMap, takeWhile } from 'rxjs/operators';

import {
  FINAL_STATUSES,
  Simulation,
  SimulationPage,
  SimulationProgress,
  SimulationResults,
  SimulationStatus,
} from '../models';

const POLL_INTERVAL_MS = 2000;

@Injectable({ providedIn: 'root' })
export class SimulationService {
  private http = inject(HttpClient);
  private readonly API_URL = '/api/v1/simulations';

  getSimulations(options: { skip?: number; limit?: number; status?: SimulationStatus | null } = {}): Observable<SimulationPage> {
    let params = new HttpParams().set('skip', options.skip ?? 0).set('limit', options.limit ?? 20);
    if (options.status) params = params.set('status', options.status);
    return this.http.get<SimulationPage>(this.API_URL, { params });
  }

  getSimulation(id: number | string): Observable<Simulation> {
    return this.http.get<Simulation>(`${this.API_URL}/${id}`);
  }

  launchSimulation(networkId: number | string, experimentParams: Record<string, unknown>, name?: string): Observable<{ simulation_id: number }> {
    const formData = new FormData();
    formData.append('network_id', String(networkId));
    formData.append('params', JSON.stringify(experimentParams));
    if (name) formData.append('name', name);
    return this.http.post<{ simulation_id: number }>(`${this.API_URL}/launch`, formData);
  }

  getStatus(id: number | string): Observable<SimulationProgress> {
    return this.http.get<SimulationProgress>(`${this.API_URL}/${id}/status`);
  }

  /**
   * Stato ogni 2 s finché la simulazione non è in uno stato finale (incluso).
   * Un errore passeggero salta un giro senza chiudere lo stream; un 404
   * (simulazione eliminata) lo chiude con errore.
   */
  pollStatus(id: number | string): Observable<SimulationProgress> {
    return timer(0, POLL_INTERVAL_MS).pipe(
      switchMap(() =>
        this.getStatus(id).pipe(
          catchError((error: HttpErrorResponse) => (error.status === 404 ? throwError(() => error) : EMPTY)),
        ),
      ),
      takeWhile((progress) => !FINAL_STATUSES.includes(progress.status), true),
    );
  }

  abortSimulation(id: number | string): Observable<unknown> {
    return this.http.post(`${this.API_URL}/${id}/abort`, {});
  }

  getResults(id: number | string): Observable<SimulationResults> {
    return this.http.get<SimulationResults>(`${this.API_URL}/${id}/results`);
  }

  deleteSimulation(id: number | string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }
}
