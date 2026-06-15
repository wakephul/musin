import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';

// Functional Auth Guard
const authGuard = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.isAuthenticated() ? true : router.parseUrl('/login');
};

const publicGuard = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return !authService.isAuthenticated() ? true : router.parseUrl('/dashboard');
};

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  {
    path: 'login',
    canActivate: [publicGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },

  // Authenticated area — wrapped in the global navigation shell
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/layout/layout.component').then((m) => m.LayoutComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'networks/new',
        loadComponent: () =>
          import('./features/networks/network-builder/network-builder.component').then(
            (m) => m.NetworkBuilderComponent,
          ),
      },
      {
        path: 'networks/:id',
        loadComponent: () =>
          import('./features/networks/network-builder/network-builder.component').then(
            (m) => m.NetworkBuilderComponent,
          ),
      },
      {
        path: 'simulations/run/:id',
        loadComponent: () =>
          import('./features/simulations/simulation-runner/simulation-runner.component').then(
            (m) => m.SimulationRunnerComponent,
          ),
      },
      {
        path: 'simulations/detail/:id',
        loadComponent: () =>
          import('./features/simulations/simulation-detail/simulation-detail.component').then(
            (m) => m.SimulationDetailComponent,
          ),
      },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
