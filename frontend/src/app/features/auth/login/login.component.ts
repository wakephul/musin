import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { apiErrorMessage } from '../../../core/utils/errors';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="mx-auto mt-24 w-full max-w-sm px-5">
      <h1 class="text-xl font-semibold">MuSiN</h1>
      <p class="mt-1 text-muted">Reti neurali a spike e simulazioni NEST.</p>

      <form class="panel mt-6 space-y-4 p-5" [formGroup]="form" (ngSubmit)="submit()">
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" type="email" class="input" formControlName="email" autocomplete="username" />
        </div>
        <div>
          <label class="label" for="password">Password</label>
          <input id="password" type="password" class="input" formControlName="password" autocomplete="current-password" />
        </div>
        @if (error()) {
          <p class="notice notice-error" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="btn btn-primary w-full" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Accesso in corso…' : 'Accedi' }}
        </button>
      </form>

      @if (registrationEnabled()) {
        <p class="mt-4 text-sm text-muted">Non hai un account? <a routerLink="/register">Registrati</a></p>
      }
    </main>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected loading = signal(false);
  protected error = signal<string | null>(null);
  protected registrationEnabled = toSignal(this.auth.registrationEnabled().pipe(catchError(() => of(false))), {
    initialValue: false,
  });

  submit(): void {
    if (this.form.invalid) return;
    const { email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(email, password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'Accesso non riuscito.'));
        this.loading.set(false);
      },
    });
  }
}
