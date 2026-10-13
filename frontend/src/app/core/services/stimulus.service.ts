import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Stimulus } from '../models';

@Injectable({ providedIn: 'root' })
export class StimulusService {
  private http = inject(HttpClient);
  private readonly API_URL = '/api/v1/stimuli';

  getStimuli(): Observable<Stimulus[]> {
    return this.http.get<Stimulus[]>(this.API_URL);
  }

  /** File .json, .csv, .h5 o .hdf5 con treni di spike (tempi in ms). */
  uploadStimulus(name: string, file: File, description?: string): Observable<Stimulus> {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('file', file);
    if (description) formData.append('description', description);
    return this.http.post<Stimulus>(`${this.API_URL}/upload`, formData);
  }

  deleteStimulus(id: number): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }
}
