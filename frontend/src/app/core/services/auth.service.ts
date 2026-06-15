import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { tap, catchError } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';

export interface User {
  id: string;
  username: string;
  email?: string;
  role: string;
}

interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User; // Obbligatorio ora che il backend lo invia
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);

  // Stato atomico con Signals
  private tokenSignal = signal<string | null>(
    localStorage.getItem('musin_token'),
  );
  private userSignal = signal<User | null>(null);

  // Computed signals per la UI
  public isAuthenticated = computed(() => !!this.tokenSignal());
  public currentUser = computed(() => this.userSignal());

  constructor() {
    // Idratazione dello stato dell'utente all'avvio (F5)
    const savedUser = localStorage.getItem('musin_user');
    if (savedUser && savedUser !== 'undefined') {
      try {
        this.userSignal.set(JSON.parse(savedUser));
      } catch (e) {
        this.logout();
      }
    }
  }

  login(credentials: any): Observable<AuthResponse> {
    // Preparazione payload x-www-form-urlencoded
    const body = new HttpParams()
      .set('username', credentials.username)
      .set('password', credentials.password);

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    return this.http
      .post<AuthResponse>('/api/v1/auth/login', body.toString(), { headers })
      .pipe(
        tap((response) => {
          // 1. Persistenza Token
          this.tokenSignal.set(response.access_token);
          localStorage.setItem('musin_token', response.access_token);

          // 2. Persistenza Utente (Ricevuto direttamente da SQLAlchemy/Pydantic)
          this.userSignal.set(response.user);
          localStorage.setItem('musin_user', JSON.stringify(response.user));
        }),
        catchError((error) => {
          console.error('Login Error:', error);
          let msg = 'Errore di connessione al server.';
          if (error.status === 422) msg = 'Formato dati non valido (422).';
          if (error.status === 401) msg = 'Credenziali errate.';
          return throwError(() => new Error(msg));
        }),
      );
  }

  logout(): void {
    localStorage.removeItem('musin_token');
    localStorage.removeItem('musin_user');
    this.tokenSignal.set(null);
    this.userSignal.set(null);
  }

  getToken(): string | null {
    return this.tokenSignal();
  }
}
