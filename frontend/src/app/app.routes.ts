import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';

import { AuthService } from './core/services/auth.service';

const authGuard = () => (inject(AuthService).isAuthenticated() ? true : inject(Router).parseUrl('/login'));
const publicGuard = () => (inject(AuthService).isAuthenticated() ? inject(Router).parseUrl('/dashboard') : true);

const networkBuilder = () =>
  import('./features/networks/network-builder/network-builder.component').then((m) => m.NetworkBuilderComponent);

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    canActivate: [publicGuard],
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [publicGuard],
    loadComponent: () => import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/layout.component').then((m) => m.LayoutComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      { path: 'networks/new', loadComponent: networkBuilder },
      { path: 'networks/:id', loadComponent: networkBuilder },
      {
        path: 'simulations/run/:id',
        loadComponent: () =>
          import('./features/simulations/simulation-runner/simulation-runner.component').then((m) => m.SimulationRunnerComponent),
      },
      {
        path: 'simulations/detail/:id',
        loadComponent: () =>
          import('./features/simulations/simulation-detail/simulation-detail.component').then((m) => m.SimulationDetailComponent),
      },
      {
        path: 'stimuli',
        loadComponent: () => import('./features/stimuli/stimuli.component').then((m) => m.StimuliComponent),
      },
      {
        path: 'account',
        loadComponent: () => import('./features/account/account.component').then((m) => m.AccountComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
