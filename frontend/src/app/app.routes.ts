import { inject } from '@angular/core';
import { CanDeactivateFn, Router, Routes } from '@angular/router';

import { AuthService } from './core/services/auth.service';

const authGuard = () => (inject(AuthService).isAuthenticated() ? true : inject(Router).parseUrl('/login'));
const publicGuard = () => (inject(AuthService).isAuthenticated() ? inject(Router).parseUrl('/dashboard') : true);
// L'uscita è una rotta: così passa dalle guardie della pagina corrente e, se l'utente annulla, la sessione resta aperta.
const logoutGuard = () => {
  inject(AuthService).logout();
  return inject(Router).parseUrl('/login');
};

const networkBuilder = () =>
  import('./features/networks/network-builder/network-builder.component').then((m) => m.NetworkBuilderComponent);

// Unico punto in cui si usa confirm(): l'uscita va fermata prima che il router distrugga la pagina.
const confirmUnsavedChanges: CanDeactivateFn<{ hasUnsavedChanges(): boolean }> = (component) =>
  !component.hasUnsavedChanges() || confirm('Ci sono modifiche non salvate alla rete. Uscire senza salvare?');

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
  { path: 'logout', canActivate: [logoutGuard], children: [] },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/layout.component').then((m) => m.LayoutComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      { path: 'networks/new', loadComponent: networkBuilder, canDeactivate: [confirmUnsavedChanges] },
      { path: 'networks/:id', loadComponent: networkBuilder, canDeactivate: [confirmUnsavedChanges] },
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
