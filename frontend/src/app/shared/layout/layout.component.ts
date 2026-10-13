import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex h-12 max-w-6xl items-center gap-6 px-5">
        <a routerLink="/dashboard" class="text-base font-semibold text-ink hover:no-underline">MuSiN</a>
        <nav class="flex items-center gap-4 text-sm" aria-label="Sezioni">
          @for (link of links; track link.path) {
            <a
              [routerLink]="link.path"
              routerLinkActive="!text-ink font-medium"
              class="text-muted hover:text-ink hover:no-underline"
              >{{ link.label }}</a
            >
          }
        </nav>
        <div class="ml-auto flex items-center gap-3 text-sm">
          <a routerLink="/account" routerLinkActive="!text-ink" class="text-muted hover:text-ink hover:no-underline">
            {{ auth.currentUser()?.email }}
          </a>
          <button type="button" class="btn btn-quiet btn-sm" (click)="logout()">Esci</button>
        </div>
      </div>
    </header>
    <main>
      <router-outlet />
    </main>
  `,
})
export class LayoutComponent {
  protected auth = inject(AuthService);
  private router = inject(Router);

  protected readonly links = [
    { path: '/dashboard', label: 'Panoramica' },
    { path: '/networks/new', label: 'Nuova rete' },
    { path: '/stimuli', label: 'Stimoli' },
  ];

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
