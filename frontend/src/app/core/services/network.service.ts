import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { ModelCatalogue, Network, NetworkPayload } from '../models';

@Injectable({ providedIn: 'root' })
export class NetworkService {
  private http = inject(HttpClient);
  private readonly API_URL = '/api/v1/networks';

  getModels(): Observable<ModelCatalogue> {
    return this.http.get<ModelCatalogue>(`${this.API_URL}/models`);
  }

  getNetworks(): Observable<Network[]> {
    return this.http.get<Network[]>(this.API_URL);
  }

  getNetwork(id: number | string): Observable<Network> {
    return this.http.get<Network>(`${this.API_URL}/${id}`);
  }

  createNetwork(network: NetworkPayload): Observable<Network> {
    return this.http.post<Network>(this.API_URL, network);
  }

  updateNetwork(id: number | string, network: Partial<NetworkPayload>): Observable<Network> {
    return this.http.put<Network>(`${this.API_URL}/${id}`, network);
  }

  /** Copia la rete sul server; la copia ricorda l'originale in `parent_id`. */
  forkNetwork(id: number | string, name?: string): Observable<Network> {
    return this.http.post<Network>(`${this.API_URL}/${id}/fork`, name ? { name } : {});
  }

  deleteNetwork(id: number | string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }
}
