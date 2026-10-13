import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, switchMap, timer } from 'rxjs';

import { EXPERIMENT_LABELS, STATUS_LABELS, Simulation, SimulationStatus } from '../../../core/models';
import { SimulationService } from '../../../core/services/simulation.service';
import { apiErrorMessage } from '../../../core/utils/errors';
import { ConfirmButtonComponent } from '../../../shared/components/confirm-button/confirm-button.component';

const PAGE_SIZE = 20;
const REFRESH_MS = 5000;

// Classi scritte per esteso: Tailwind tiene solo quelle che trova nei sorgenti.
const STATUS_CLASS: Record<SimulationStatus, string> = {
  PENDING: 'status status-pending',
  RUNNING: 'status status-running',
  COMPLETED: 'status status-completed',
  FAILED: 'status status-failed',
  ABORTED: 'status',
};

const FILTERS: { value: SimulationStatus | null; label: string }[] = [
  { value: null, label: 'Tutte' },
  { value: 'RUNNING', label: 'In corso' },
  { value: 'PENDING', label: 'In coda' },
  { value: 'COMPLETED', label: 'Completate' },
  { value: 'FAILED', label: 'Fallite' },
  { value: 'ABORTED', label: 'Interrotte' },
];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

@Component({
  selector: 'app-simulation-list',
  standalone: true,
  imports: [DatePipe, RouterLink, ConfirmButtonComponent],
  host: { class: 'block' },
  template: `
    <section class="panel" aria-labelledby="simulations-title">
      <div class="panel-header">
        <div>
          <h2 id="simulations-title" class="section-title">Simulazioni</h2>
          @if (summary()) {
            <p class="mt-0.5 text-sm text-muted">{{ summary() }}</p>
          }
        </div>
        <button type="button" class="btn" [disabled]="loading()" (click)="reload()">Aggiorna</button>
      </div>
      <div class="tabs px-4 pt-3" role="group" aria-label="Filtra per stato">
        @for (option of filters; track option.label) {
          <button
            type="button"
            class="tab"
            [class.tab-active]="filter() === option.value"
            [attr.aria-pressed]="filter() === option.value"
            (click)="setFilter(option.value)"
          >
            {{ option.label }}
          </button>
        }
      </div>
      @if (error()) {
        <p class="notice notice-error m-4" role="alert">{{ error() }}</p>
      }
      @if (simulations(); as rows) {
        @if (rows.length) {
          <div class="overflow-x-auto">
            <table class="table-list" [attr.aria-busy]="loading()">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Esperimento</th>
                  <th scope="col">Rete</th>
                  <th scope="col">Stato</th>
                  <th scope="col" class="whitespace-nowrap">Avviata il</th>
                  <th scope="col"><span class="sr-only">Azioni</span></th>
                </tr>
              </thead>
              <tbody>
                @for (sim of rows; track sim.id) {
                  <tr>
                    <td class="num text-muted">{{ sim.id }}</td>
                    <td class="whitespace-nowrap">
                      {{ experimentLabels[sim.experiment] || sim.experiment }}
                      @if (sim.name && sim.name !== sim.network_name) {
                        <div class="max-w-[14rem] truncate text-xs text-muted" [title]="sim.name">{{ sim.name }}</div>
                      }
                    </td>
                    <!-- w-full + max-w-0: la colonna prende lo spazio che resta e tronca invece di allargare la tabella -->
                    <td class="w-full max-w-0 truncate" [title]="sim.network_name ?? ''">{{ sim.network_name ?? 'n/d' }}</td>
                    <td class="whitespace-nowrap">
                      <span [class]="statusClass[sim.status]">{{ statusLabels[sim.status] }}</span>
                      @if (sim.status === 'FAILED' && sim.error_message) {
                        <div class="max-w-[12rem] truncate text-xs text-muted" [title]="sim.error_message">{{ sim.error_message }}</div>
                      }
                    </td>
                    <td class="num whitespace-nowrap text-muted">{{ sim.created_at | date: 'dd/MM/yyyy HH:mm' }}</td>
                    <td class="whitespace-nowrap text-right">
                      <div class="inline-flex items-start gap-1">
                        @if (!remove.armed()) {
                          <a class="btn btn-sm" [routerLink]="['/simulations/detail', sim.id]">Apri</a>
                        }
                        <app-confirm-button
                          #remove
                          [hint]="sim.status === 'RUNNING' ? 'La simulazione in corso viene fermata.' : undefined"
                          [disabled]="loading()"
                          (confirmed)="delete(sim)"
                        />
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
            <span class="num text-xs text-muted">{{ range() }}</span>
            <div class="flex gap-2">
              <button type="button" class="btn btn-sm" [disabled]="page() === 1 || loading()" (click)="goToPage(page() - 1)">
                Precedente
              </button>
              <button type="button" class="btn btn-sm" [disabled]="page() >= lastPage() || loading()" (click)="goToPage(page() + 1)">
                Successiva
              </button>
            </div>
          </div>
        } @else if (filter()) {
          <p class="empty">Nessuna simulazione in questo stato.</p>
        } @else {
          <p class="empty">Nessuna simulazione: per avviarne una usa Simula sulla riga di una rete.</p>
        }
      } @else if (loading()) {
        <p class="empty">Caricamento…</p>
      }
    </section>
  `,
})
export class SimulationListComponent {
  private simulationService = inject(SimulationService);

  protected readonly filters = FILTERS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusClass = STATUS_CLASS;
  protected readonly experimentLabels: Record<string, string> = EXPERIMENT_LABELS;

  /** `null` durante il primo caricamento, al cambio di filtro e dopo un errore. */
  protected simulations = signal<Simulation[] | null>(null);
  protected loading = signal(true);
  protected error = signal<string | null>(null);
  protected total = signal(0);
  protected counts = signal<Record<SimulationStatus, number> | null>(null);
  protected filter = signal<SimulationStatus | null>(null);
  protected page = signal(1);
  protected lastPage = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  protected range = computed(() => {
    const first = (this.page() - 1) * PAGE_SIZE + 1;
    const last = first + (this.simulations()?.length ?? 0) - 1;
    return `${first}–${last} di ${this.total()}`;
  });

  protected summary = computed(() => {
    const counts = this.counts();
    if (!counts) return '';
    const all = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (!all) return '';
    return (
      `${plural(all, 'simulazione', 'simulazioni')}: ` +
      [
        plural(counts.COMPLETED, 'completata', 'completate'),
        plural(counts.FAILED, 'fallita', 'fallite'),
        plural(counts.ABORTED, 'interrotta', 'interrotte'),
        `${counts.RUNNING} in corso`,
        `${counts.PENDING} in coda`,
      ].join(', ')
    );
  });

  private hasActive = computed(() => {
    const counts = this.counts();
    return !!counts && counts.RUNNING + counts.PENDING > 0;
  });
  private request = new Subject<void>();

  constructor() {
    // switchMap scarta la risposta di una richiesta superata da un cambio di filtro o di pagina.
    this.request
      .pipe(
        switchMap(() =>
          this.simulationService
            .getSimulations({ skip: (this.page() - 1) * PAGE_SIZE, limit: PAGE_SIZE, status: this.filter() })
            .pipe(
              catchError((err) => {
                this.simulations.set(null);
                this.error.set(apiErrorMessage(err, 'Elenco delle simulazioni non caricato.'));
                this.loading.set(false);
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.counts.set(result.counts);
        const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        // La pagina non esiste più (eliminata la sua ultima riga, o elenco cambiato nel frattempo).
        if (this.page() > lastPage) {
          this.page.set(lastPage);
          this.request.next();
          return;
        }
        this.simulations.set(result.items);
        this.total.set(result.total);
        this.error.set(null);
        this.loading.set(false);
      });

    // Aggiornamento automatico solo finché c'è qualcosa in corso o in coda.
    toObservable(this.hasActive)
      .pipe(
        switchMap((active) => (active ? timer(REFRESH_MS, REFRESH_MS) : EMPTY)),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.request.next());

    this.request.next();
  }

  reload(): void {
    this.loading.set(true);
    this.request.next();
  }

  protected setFilter(status: SimulationStatus | null): void {
    if (status === this.filter()) return;
    this.filter.set(status);
    this.page.set(1);
    this.simulations.set(null);
    this.reload();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.reload();
  }

  protected delete(simulation: Simulation): void {
    this.loading.set(true);
    this.simulationService.deleteSimulation(simulation.id).subscribe({
      next: () => this.reload(),
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'Simulazione non eliminata.'));
        this.loading.set(false);
      },
    });
  }
}
