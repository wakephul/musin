import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  EXPERIMENT_LABELS,
  FINAL_STATUSES,
  STATUS_LABELS,
  Simulation,
  SimulationProgress,
  SimulationResults,
  SimulationStatus,
} from '../../../core/models';
import { SimulationService } from '../../../core/services/simulation.service';
import { apiErrorMessage } from '../../../core/utils/errors';
import { ConfirmButtonComponent } from '../../../shared/components/confirm-button/confirm-button.component';
import { ItNumPipe } from './it-num.pipe';
import { SimulationResultsComponent } from './simulation-results.component';

// Classi scritte per esteso: Tailwind tiene solo quelle che trova nei sorgenti.
const STATUS_CLASS: Record<SimulationStatus, string> = {
  PENDING: 'status status-pending',
  RUNNING: 'status status-running',
  COMPLETED: 'status status-completed',
  FAILED: 'status status-failed',
  ABORTED: 'status',
};

@Component({
  selector: 'app-simulation-detail',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    ConfirmButtonComponent,
    ItNumPipe,
    SimulationResultsComponent,
  ],
  template: `
    <div class="page">
      <p class="breadcrumb">
        <a routerLink="/dashboard">Panoramica</a> / Simulazione <span class="num">#{{ id }}</span>
      </p>

      @if (gone(); as message) {
        <p class="notice" role="alert">{{ message }} <a routerLink="/dashboard">Torna alla panoramica</a></p>
      } @else if (loadError()) {
        <div class="notice notice-error flex flex-wrap items-center gap-3" role="alert">
          <span>{{ loadError() }}</span>
          <button type="button" class="btn btn-sm" (click)="load()">Riprova</button>
        </div>
      } @else {
        @if (simulation(); as sim) {
          <header class="page-header">
            <div>
              <h1 class="page-title">
                Simulazione <span class="num">#{{ sim.id }}</span>
              </h1>
              @if (sim.name && sim.name !== sim.network_name) {
                <p class="page-subtitle">{{ sim.name }}</p>
              }
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <button type="button" class="btn" (click)="relaunch(sim)">Rilancia con questi parametri</button>
              @if (active()) {
                <app-confirm-button
                  label="Interrompi"
                  confirmLabel="Conferma interruzione"
                  [disabled]="busy()"
                  (confirmed)="abort()"
                />
              }
              <app-confirm-button
                label="Elimina"
                confirmLabel="Conferma eliminazione"
                [hint]="deleteHint()"
                [disabled]="busy()"
                (confirmed)="remove()"
              />
            </div>
          </header>

          <div class="space-y-5">
            @if (actionError()) {
              <p class="notice notice-error" role="alert">{{ actionError() }}</p>
            }

            <dl class="panel grid grid-cols-2 gap-x-6 gap-y-3 p-4 lg:grid-cols-4">
              <div>
                <dt class="label">Esperimento</dt>
                <dd>{{ experimentLabels[sim.experiment] || sim.experiment }}</dd>
              </div>
              <div>
                <dt class="label">Rete</dt>
                <dd>
                  <a [routerLink]="['/networks', sim.network_id]">{{ sim.network_name || 'Rete #' + sim.network_id }}</a>
                </dd>
              </div>
              <div>
                <dt class="label">Avviata</dt>
                <dd class="num">{{ sim.created_at | date: 'dd/MM/yyyy HH:mm' }}</dd>
              </div>
              <div>
                <dt class="label">Stato</dt>
                <dd>
                  <span [class]="statusClass[status()]">{{ statusLabels[status()] }}</span>
                </dd>
              </div>
            </dl>

            @if (active()) {
              <div class="panel panel-body space-y-2">
                <div class="flex items-baseline justify-between gap-3 text-sm">
                  <span role="status">{{ phase() }}</span>
                  <span class="num">{{ percent() }}%</span>
                </div>
                <div
                  class="progress"
                  role="progressbar"
                  aria-label="Avanzamento della simulazione"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  [attr.aria-valuenow]="percent()"
                >
                  <span [style.width.%]="percent()"></span>
                </div>
              </div>
            }

            @if (status() === 'FAILED') {
              <div class="notice notice-error" role="alert">
                <p class="font-medium">La simulazione è fallita.</p>
                @if (sim.error_message) {
                  <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{{ sim.error_message }}</pre>
                } @else {
                  <p class="mt-1">Motivo non registrato.</p>
                }
              </div>
            }

            @if (status() === 'ABORTED') {
              <p class="notice">La simulazione è stata interrotta: non ci sono risultati.</p>
            }

            <details class="panel">
              <summary class="cursor-pointer px-4 py-3 font-medium">Parametri</summary>
              <div class="space-y-3 border-t border-line p-4">
                <p class="text-sm">
                  Durata simulata: <span class="num">{{ sim.duration_ms / 1000 | itNum: 3 : 0 }} s</span>
                </p>
                <pre class="code-block">{{ paramsJson() }}</pre>
              </div>
            </details>

            @if (status() === 'COMPLETED') {
              @if (results(); as res) {
                <app-simulation-results [results]="res" />
              } @else if (resultsError()) {
                <div class="notice notice-error flex flex-wrap items-center gap-3" role="alert">
                  <span>{{ resultsError() }}</span>
                  <button type="button" class="btn btn-sm" (click)="loadResults()">Riprova</button>
                </div>
              } @else {
                <p class="text-muted" role="status">Caricamento dei risultati…</p>
              }
            }
          </div>
        } @else {
          <p class="text-muted" role="status">Caricamento della simulazione…</p>
        }
      }
    </div>
  `,
})
export class SimulationDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private simulationService = inject(SimulationService);
  private destroyRef = inject(DestroyRef);

  protected readonly id = this.route.snapshot.paramMap.get('simulationId') ?? this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly statusClass = STATUS_CLASS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly experimentLabels: Record<string, string> = EXPERIMENT_LABELS;

  protected simulation = signal<Simulation | null>(null);
  protected results = signal<SimulationResults | null>(null);
  protected progress = signal<SimulationProgress | null>(null);
  protected loadError = signal<string | null>(null);
  protected resultsError = signal<string | null>(null);
  protected actionError = signal<string | null>(null);
  /** Messaggio quando la simulazione non esiste più (404). */
  protected gone = signal<string | null>(null);
  protected busy = signal(false);

  /** Durante il polling lo stato più recente è quello dell'avanzamento. */
  protected readonly status = computed<SimulationStatus>(
    () => this.progress()?.status ?? this.simulation()?.status ?? 'PENDING',
  );
  protected readonly active = computed(() => !FINAL_STATUSES.includes(this.status()));
  protected readonly percent = computed(() => Math.round(Math.min(100, Math.max(0, this.progress()?.progress ?? 0))));
  protected readonly phase = computed(
    () => this.progress()?.phase || (this.status() === 'PENDING' ? 'In attesa del worker.' : 'Simulazione in corso.'),
  );
  protected readonly deleteHint = computed(() => {
    if (this.active()) return 'La simulazione viene fermata.';
    return this.status() === 'COMPLETED' ? 'Vengono eliminati anche i risultati.' : undefined;
  });
  protected readonly paramsJson = computed(() => JSON.stringify(this.simulation()?.experiment_params ?? {}, null, 2));

  private pollSubscription?: Subscription;

  constructor() {
    this.load();
  }

  /** Carica la simulazione e, secondo lo stato, avvia il polling o carica i risultati. */
  protected load(): void {
    this.pollSubscription?.unsubscribe();
    this.loadError.set(null);
    this.simulationService
      .getSimulation(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (simulation) => {
          this.simulation.set(simulation);
          this.progress.set(null);
          if (!FINAL_STATUSES.includes(simulation.status)) this.poll();
          else if (simulation.status === 'COMPLETED') this.loadResults();
        },
        error: (err) => {
          if (err instanceof HttpErrorResponse && err.status === 404) this.gone.set('Simulazione non trovata.');
          else this.loadError.set(apiErrorMessage(err, 'Simulazione non caricata.'));
        },
      });
  }

  private poll(): void {
    this.pollSubscription = this.simulationService
      .pollStatus(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progress) => {
          // L'ultimo valore dello stream è lo stato finale: si ricarica la simulazione per avere esito e risultati.
          if (FINAL_STATUSES.includes(progress.status)) this.load();
          else this.progress.set(progress);
        },
        // pollStatus va in errore solo con un 404.
        error: () => this.gone.set('La simulazione è stata eliminata.'),
      });
  }

  protected loadResults(): void {
    this.resultsError.set(null);
    this.simulationService
      .getResults(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => this.results.set(results),
        error: (err) => this.resultsError.set(apiErrorMessage(err, 'Risultati non caricati.')),
      });
  }

  protected abort(): void {
    this.actionError.set(null);
    this.busy.set(true);
    this.simulationService
      .abortSimulation(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.load();
        },
        error: (err) => {
          this.actionError.set(apiErrorMessage(err, 'Simulazione non interrotta.'));
          this.busy.set(false);
        },
      });
  }

  protected remove(): void {
    this.actionError.set(null);
    this.busy.set(true);
    // Il polling si ferma prima: altrimenti il suo 404 mostrerebbe "eliminata" un attimo prima del ritorno alla panoramica.
    this.pollSubscription?.unsubscribe();
    this.simulationService
      .deleteSimulation(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.router.navigate(['/dashboard']),
        error: (err) => {
          this.actionError.set(apiErrorMessage(err, 'Simulazione non eliminata.'));
          this.busy.set(false);
          this.load();
        },
      });
  }

  protected relaunch(simulation: Simulation): void {
    this.router.navigate(['/simulations/run', simulation.network_id], {
      state: { cloneParams: simulation.experiment_params },
    });
  }
}
