import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { apiErrorMessage } from '../../../core/utils/errors';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="mx-auto mt-24 w-full max-w-sm px-5">
      <h1 class="text-xl font-semibold">Crea un account</h1>

      <form class="panel mt-6 space-y-4 p-5" [formGroup]="form" (ngSubmit)="submit()">
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" type="email" class="input" formControlName="email" autocomplete="username" />
        </div>
        <div>
          <label class="label" for="password">Password</label>
          <input id="password" type="password" class="input" formControlName="password" autocomplete="new-password" />
          <p class="help">Almeno {{ minLength }} caratteri.</p>
        </div>
        <div>
          <label class="label" for="confirm">Ripeti la password</label>
          <input id="confirm" type="password" class="input" formControlName="confirm" autocomplete="new-password" />
          @if (form.controls.confirm.touched && mismatch()) {
            <p class="field-error">Le due password non coincidono.</p>
          }
        </div>
        @if (error()) {
          <p class="notice notice-error" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="btn btn-primary w-full" [disabled]="form.invalid || mismatch() || loading()">
          {{ loading() ? 'Creazione in corso…' : 'Crea account' }}
        </button>
      </form>

      <p class="mt-4 text-sm text-muted">Hai già un account? <a routerLink="/login">Accedi</a></p>
    </main>
  `,
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected readonly minLength = PASSWORD_MIN_LENGTH;
  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH), Validators.maxLength(PASSWORD_MAX_LENGTH)]],
    confirm: ['', Validators.required],
  });
  protected loading = signal(false);
  protected error = signal<string | null>(null);

  protected mismatch(): boolean {
    const { password, confirm } = this.form.getRawValue();
    return password !== confirm;
  }

  submit(): void {
    if (this.form.invalid || this.mismatch()) return;
    const { email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.auth.register(email, password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'Registrazione non riuscita.'));
        this.loading.set(false);
      },
    });
  }
}
