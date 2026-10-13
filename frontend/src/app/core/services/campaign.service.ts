import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Campaign, CampaignSummary, ReferenceSet, Sweep } from '../models';

export interface CampaignRequest {
  network_id: number;
  name?: string;
  params: Record<string, unknown>;
  seeds: number[];
  sweep: Sweep | null;
  save_spikes: boolean;
}

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private http = inject(HttpClient);
  private readonly API_URL = '/api/v1/campaigns';
  private readonly REFERENCES_URL = '/api/v1/references';

  getCampaigns(): Observable<Campaign[]> {
    return this.http.get<Campaign[]>(this.API_URL);
  }

  getCampaign(id: number | string): Observable<Campaign> {
    return this.http.get<Campaign>(`${this.API_URL}/${id}`);
  }

  createCampaign(request: CampaignRequest): Observable<Campaign> {
    return this.http.post<Campaign>(this.API_URL, request);
  }

  /** Tempi di risposta delle simulazioni completate messi insieme; il server li ricalcola solo se sono cambiate. */
  getSummary(id: number | string): Observable<CampaignSummary> {
    return this.http.get<CampaignSummary>(`${this.API_URL}/${id}/summary`);
  }

  setReference(id: number | string, reference: string | null): Observable<Campaign> {
    return this.http.put<Campaign>(`${this.API_URL}/${id}`, { reference });
  }

  abortCampaign(id: number | string): Observable<{ aborted: number }> {
    return this.http.post<{ aborted: number }>(`${this.API_URL}/${id}/abort`, {});
  }

  deleteCampaign(id: number | string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }

  getReferenceSets(): Observable<ReferenceSet[]> {
    return this.http.get<ReferenceSet[]>(this.REFERENCES_URL);
  }

  /** CSV con due colonne: condizione (A, V, AV, race) e tempo di risposta in ms. */
  uploadReferenceSet(name: string, file: File): Observable<ReferenceSet> {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('file', file);
    return this.http.post<ReferenceSet>(this.REFERENCES_URL, formData);
  }

  deleteReferenceSet(key: string): Observable<void> {
    return this.http.delete<void>(`${this.REFERENCES_URL}/${key.split(':')[1]}`);
  }
}
