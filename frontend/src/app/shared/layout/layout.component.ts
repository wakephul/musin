import { Component, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen flex flex-col bg-slate-50">
      <!-- Top navigation -->
      <header class="sticky top-0 z-40 glass-dark text-white">
        <div class="max-w-screen-2xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
          <!-- Brand -->
          <a routerLink="/dashboard" class="flex items-center gap-2.5 group">
            <span class="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-600/30">
              <svg viewBox="0 0 32 32" class="h-5 w-5" fill="none">
                <path d="M9 16c2-4 5-6 7-6s5 2 7 6c-2 4-5 6-7 6s-5-2-7-6z" stroke="white" stroke-width="2"/>
                <circle cx="16" cy="16" r="2.5" fill="white"/>
              </svg>
            </span>
            <div class="leading-none">
              <span class="block text-base font-extrabold tracking-tight">MuSiN</span>
              <span class="block text-[10px] font-medium text-slate-400 tracking-wide">Cerebellar Simulation</span>
            </div>
          </a>

          <!-- Primary nav -->
          <nav class="hidden md:flex items-center gap-1">
            <a routerLink="/dashboard" routerLinkActive="bg-white/10 text-white"
              [routerLinkActiveOptions]="{ exact: false }"
              class="px-3.5 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
              Dashboard
            </a>
            <a routerLink="/networks/new" routerLinkActive="bg-white/10 text-white"
              class="px-3.5 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
              New Network
            </a>
          </nav>

          <!-- User menu -->
          <div class="relative">
            <button (click)="menuOpen.set(!menuOpen())"
              class="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-white/5 transition-colors">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 text-sm font-bold text-white border border-white/10">
                {{ userInitial() }}
              </span>
              <span class="hidden sm:block text-sm font-semibold text-slate-200 max-w-[160px] truncate">{{ userEmail() }}</span>
              <svg class="h-4 w-4 text-slate-400" [class.rotate-180]="menuOpen()" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>

            @if (menuOpen()) {
              <div class="absolute right-0 mt-2 w-60 surface-card p-2 animate-fade-in z-50">
                <div class="px-3 py-2.5 border-b border-slate-100 mb-1">
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Signed in as</p>
                  <p class="text-sm font-semibold text-slate-800 truncate">{{ userEmail() }}</p>
                </div>
                <a routerLink="/dashboard" (click)="menuOpen.set(false)"
                  class="flex md:hidden items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  Dashboard
                </a>
                <button (click)="logout()"
                  class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
                  </svg>
                  Log out
                </button>
              </div>
            }
          </div>
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1">
        <router-outlet />
      </main>
    </div>
  `,
})
export class LayoutComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  menuOpen = signal(false);

  userEmail = () => this.auth.currentUser()?.email || this.auth.currentUser()?.username || 'Clinician';
  userInitial = () => (this.userEmail()?.[0] || 'U').toUpperCase();

  logout() {
    this.menuOpen.set(false);
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.menuOpen.set(false);
  }
}
