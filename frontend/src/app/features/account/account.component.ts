import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AuthService } from '../../core/services/auth.service';
import { apiErrorMessage } from '../../core/utils/errors';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/register/register.component';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="page max-w-md">
      <h1 class="page-title">Account</h1>
      <p class="page-subtitle">{{ auth.currentUser()?.email }}</p>

      <form class="panel mt-5 space-y-4 p-5" [formGroup]="form" (ngSubmit)="submit()">
        <h2 class="section-title">Cambia password</h2>
        <div>
          <label class="label" for="current">Password attuale</label>
          <input id="current" type="password" class="input" formControlName="current" autocomplete="current-password" />
        </div>
        <div>
          <label class="label" for="next">Nuova password</label>
          <input id="next" type="password" class="input" formControlName="next" autocomplete="new-password" />
          <p class="help">Almeno {{ minLength }} caratteri.</p>
        </div>
        @if (error()) {
          <p class="notice notice-error" role="alert">{{ error() }}</p>
        }
        @if (saved()) {
          <p class="notice notice-ok" role="status">Password aggiornata.</p>
        }
        <button type="submit" class="btn btn-primary" [disabled]="form.invalid || loading()">Salva</button>
      </form>
    </div>
  `,
})
export class AccountComponent {
  protected auth = inject(AuthService);

  protected readonly minLength = PASSWORD_MIN_LENGTH;
  protected form = inject(FormBuilder).nonNullable.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH), Validators.maxLength(PASSWORD_MAX_LENGTH)]],
  });
  protected loading = signal(false);
  protected error = signal<string | null>(null);
  protected saved = signal(false);

  submit(): void {
    if (this.form.invalid) return;
    const { current, next } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.saved.set(false);
    this.auth.changePassword(current, next).subscribe({
      next: () => {
        this.saved.set(true);
        this.form.reset();
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'Password non aggiornata.'));
        this.loading.set(false);
      },
    });
  }
}
