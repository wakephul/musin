import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators'; // <-- IMPORT FONDAMENTALE

// --- INTERFACCE DISCOVERY ---
export interface ModelParams {
  [key: string]: number;
}

export interface NeuronModel {
  id: string;
  label: string;
  default_params: ModelParams;
}

export interface SynapseModel {
  id: string;
  label: string;
  default_params: ModelParams;
}

export interface NetworkModule {
  id: string;
  label: string;
  description: string;
  neurons: NeuronModel[];
  synapses: SynapseModel[];
}

// Nuova interfaccia per mappare la risposta reale del tuo backend
export interface ModelsResponse {
  modules: NetworkModule[];
}

// --- INTERFACCE ESISTENTI ---
export interface Network {
  id: string;
  name: string;
  description: string;
  nodes_count: number;
  edges_count: number;
  created_at: string;
}

export interface Topology {
  nodes: any[];
  edges: any[];
}

@Injectable({
  providedIn: 'root',
})
export class NetworkService {
  private http = inject(HttpClient);
  private readonly API_URL = '/api/v1/networks';

  // Chiamata all'endpoint di discovery (CORRETTA)
  getModels(): Observable<NetworkModule[]> {
    return this.http.get<ModelsResponse>(`${this.API_URL}/models`).pipe(
      // Estraiamo l'array 'modules' dall'oggetto JSON padre!
      map((response) => response.modules),
    );
  }

  getNetworks(): Observable<Network[]> {
    return this.http.get<Network[]>(this.API_URL);
  }

  getNetworkById(id: string): Observable<Network> {
    return this.http.get<Network>(`${this.API_URL}/${id}`);
  }

  getTopology(id: string): Observable<Topology> {
    return this.http.get<Topology>(`${this.API_URL}/${id}/topology`);
  }

  createNetwork(network: Partial<Network>): Observable<Network> {
    return this.http.post<Network>(this.API_URL, network);
  }

  updateNetwork(id: string, network: Partial<Network>): Observable<Network> {
    return this.http.put<Network>(`${this.API_URL}/${id}`, network);
  }

  deleteNetwork(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }
}
