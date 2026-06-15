import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <!-- Cinematic backdrop -->
      <div class="aurora"></div>
      <div class="absolute inset-0 grid-overlay opacity-40"></div>

      <!-- Brand mark (top-left) -->
      <div class="absolute top-6 left-6 flex items-center gap-2.5 animate-fade-in z-10">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-600/40">
          <svg viewBox="0 0 32 32" class="h-5 w-5" fill="none">
            <path d="M9 16c2-4 5-6 7-6s5 2 7 6c-2 4-5 6-7 6s-5-2-7-6z" stroke="white" stroke-width="2"/>
            <circle cx="16" cy="16" r="2.5" fill="white"/>
          </svg>
        </span>
        <span class="text-white font-extrabold tracking-tight text-lg">MuSiN</span>
      </div>

      <!-- Login card -->
      <div class="relative z-10 w-full max-w-md">
        <div class="text-center mb-8 animate-fade-rise">
          <h1 class="text-4xl font-extrabold text-white tracking-tight">
            Cerebellar Simulation
          </h1>
          <p class="text-slate-400 mt-3 text-sm max-w-sm mx-auto leading-relaxed">
            Reproduce clinical protocols in silico and run multi-scale spiking
            network experiments on the cerebellum.
          </p>
        </div>

        <div class="glass-dark rounded-2xl p-8 shadow-2xl animate-fade-rise delay-100">
          <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="space-y-5">
            @if (errorMessage()) {
              <div class="flex items-start gap-2.5 bg-red-500/10 text-red-300 p-3 rounded-xl text-sm border border-red-500/20 animate-fade-in">
                <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                {{ errorMessage() }}
              </div>
            }

            <div>
              <label for="username" class="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                Clinical Username
              </label>
              <input id="username" type="text" formControlName="username" autocomplete="username"
                placeholder="name@institution.org"
                class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                [class.border-red-400]="loginForm.get('username')?.invalid && loginForm.get('username')?.touched"/>
              @if (loginForm.get('username')?.invalid && loginForm.get('username')?.touched) {
                <p class="text-red-400 text-xs mt-1.5">Username is required.</p>
              }
            </div>

            <div>
              <label for="password" class="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                Password
              </label>
              <input id="password" type="password" formControlName="password" autocomplete="current-password"
                placeholder="••••••••"
                class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                [class.border-red-400]="loginForm.get('password')?.invalid && loginForm.get('password')?.touched"/>
              @if (loginForm.get('password')?.invalid && loginForm.get('password')?.touched) {
                <p class="text-red-400 text-xs mt-1.5">Password is required.</p>
              }
            </div>

            <button type="submit" [disabled]="loginForm.invalid || isLoading()"
              class="btn-primary w-full py-3.5 rounded-xl text-base">
              @if (isLoading()) {
                <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Authenticating...
              } @else {
                Enter the Platform
              }
            </button>
          </form>

          <!-- Demo hint for students / first-run -->
          <button type="button" (click)="fillDemo()"
            class="mt-5 w-full text-center text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Use demo credentials →
          </button>
        </div>

        <p class="text-center text-[11px] text-slate-600 mt-6 animate-fade-in delay-300">
          Local-first · air-gapped · NEST 3.8 + CerebNEST
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);

  isLoading = signal(false);
  errorMessage = signal<string | null>(null);

  loginForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  fillDemo() {
    this.loginForm.patchValue({ username: 'test@test.it', password: 'test' });
  }

  onSubmit() {
    if (!this.loginForm.valid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.authService.login(this.loginForm.value).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err: any) => {
        this.isLoading.set(false);
        this.errorMessage.set(err.message || 'Login failed');
      },
    });
  }
}
