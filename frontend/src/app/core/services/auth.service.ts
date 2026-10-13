import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

import { AuthResponse, User } from '../models';

const TOKEN_KEY = 'musin_token';
const USER_KEY = 'musin_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private readonly API_URL = '/api/v1/auth';

  private token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  private user = signal<User | null>(this.readStoredUser());

  readonly isAuthenticated = computed(() => !!this.token());
  readonly currentUser = this.user.asReadonly();

  login(email: string, password: string): Observable<AuthResponse> {
    const body = new HttpParams().set('username', email).set('password', password);
    return this.http.post<AuthResponse>(`${this.API_URL}/login`, body).pipe(tap((res) => this.storeSession(res)));
  }

  register(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.API_URL}/register`, { email, password })
      .pipe(tap((res) => this.storeSession(res)));
  }

  registrationEnabled(): Observable<boolean> {
    return this.http
      .get<{ registration_enabled: boolean }>(`${this.API_URL}/config`)
      .pipe(map((config) => config.registration_enabled));
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.API_URL}/change-password`, {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.token.set(null);
    this.user.set(null);
  }

  getToken(): string | null {
    return this.token();
  }

  private storeSession(response: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, response.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
    this.token.set(response.access_token);
    this.user.set(response.user);
  }

  private readStoredUser(): User | null {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
    } catch {
      return null;
    }
  }
}
