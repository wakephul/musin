import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { EXPERIMENT_LABELS, Network } from '../../../core/models';
import { NetworkService } from '../../../core/services/network.service';
import { SimulationService } from '../../../core/services/simulation.service';
import { StimulusService } from '../../../core/services/stimulus.service';
import { apiErrorMessage } from '../../../core/utils/errors';
import { countNeurons } from '../../../core/utils/topology';
import { ConditioningFormComponent } from './conditioning-form.component';
import { ContinuousFormComponent } from './continuous-form.component';
import { DecisionMakingFormComponent } from './decision-making-form.component';
import {
  BUILTIN_KINDS,
  BuiltinKind,
  MAX_SIMULATION_MS,
  RunMode,
  buildParams,
  estimateDurationMs,
  experimentKind,
  stateFromParams,
} from './experiment-params';
import { missingMsiPopulations, validateState } from './experiment-validation';
import { MsiRaceFormComponent } from './msi-race-form.component';
import { TrialProtocolFormComponent } from './trial-protocol-form.component';

const DESCRIPTIONS: Record<BuiltinKind, string> = {
  cerebellum_msi_race:
    "L'addestramento associa lo stimolo sensoriale a un segnale di insegnamento su IO_A e deprime le sinapsi GR→PC_A " +
    '(LTD controllata dalle fibre rampicanti). Il test presenta trial V, A, AV e catch, legge i tempi di reazione dal DCN ' +
    'e calcola la Race Model Inequality (Miller 1982) sulle loro distribuzioni cumulative.',
  cerebellum_conditioning:
    "Addestra le vie A e B di una rete cerebellare con stimoli uditivi o visivi e un segnale di insegnamento sull'oliva " +
    'inferiore. Il test presenta trial uditivi, visivi e audiovisivi a plasticità spenta e confronta le risposte del DCN.',
  decision_making:
    'Due popolazioni eccitatorie in competizione, con inibizione comune, ricevono lo stimolo su un lato per trial ' +
    '(rete attrattore di Wang). Il tempo di reazione è il primo superamento della soglia da parte della frequenza ' +
    'della popolazione stimolata.',
};

const seconds = (ms: number) => (ms / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 });

@Component({
  selector: 'app-simulation-runner',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MsiRaceFormComponent,
    ConditioningFormComponent,
    DecisionMakingFormComponent,
    TrialProtocolFormComponent,
    ContinuousFormComponent,
  ],
  template: `
    <div class="page">
      <nav class="breadcrumb" aria-label="Percorso"><a routerLink="/dashboard">Panoramica</a> / Nuova simulazione</nav>
      <div class="page-header">
        <h1 class="page-title">Nuova simulazione</h1>
      </div>

      @if (network(); as net) {
        <section class="panel mb-5">
          <div class="panel-header">
            <div>
              <h2 class="section-title">{{ net.name }}</h2>
              <p class="help">Rete con {{ populations().length }} popolazioni e {{ neurons() }} neuroni.</p>
            </div>
            <a class="btn btn-sm" [routerLink]="['/networks', net.id]">Apri nell'editor</a>
          </div>
          <ul class="flex flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-sm">
            @for (population of populations(); track population.id) {
              <li>
                <span class="num">{{ population.id }}</span>
                <span class="num text-muted"> {{ population.size }}</span>
              </li>
            } @empty {
              <li class="text-muted">La rete non ha popolazioni: aggiungile nell'editor.</li>
            }
          </ul>
        </section>

        <div class="tabs mb-5" role="tablist" aria-label="Tipo di simulazione">
          @for (tab of tabs; track tab.mode) {
            <button
              type="button"
              role="tab"
              class="tab"
              [class.tab-active]="state.mode === tab.mode"
              [attr.aria-selected]="state.mode === tab.mode"
              (click)="state.mode = tab.mode"
            >
              {{ tab.label }}
            </button>
          }
        </div>

        @switch (state.mode) {
          @case ('builtin') {
            <section class="panel">
              <fieldset class="panel-body">
                <legend class="sr-only">Esperimento</legend>
                @for (kind of builtinKinds; track kind) {
                  <label class="flex cursor-pointer items-start gap-2.5 py-1.5">
                    <input
                      type="radio"
                      name="builtin-kind"
                      class="mt-1 accent-accent"
                      [value]="kind"
                      [(ngModel)]="state.builtin"
                    />
                    <span>
                      <span class="font-medium">{{ labels[kind] }}</span>
                      <span class="block text-sm text-muted">{{ descriptions[kind] }}</span>
                    </span>
                  </label>
                }
              </fieldset>
              <div class="border-t border-line p-4">
                @switch (state.builtin) {
                  @case ('cerebellum_msi_race') {
                    <app-msi-race-form [draft]="state.builtinDrafts.cerebellum_msi_race" [populations]="populations()" />
                  }
                  @case ('cerebellum_conditioning') {
                    <app-conditioning-form [draft]="state.builtinDrafts.cerebellum_conditioning" />
                  }
                  @case ('decision_making') {
                    <app-decision-making-form [draft]="state.builtinDrafts.decision_making" />
                  }
                }
              </div>
            </section>
          }
          @case ('trials') {
            <app-trial-protocol-form
              [draft]="state.trials"
              [populations]="populations()"
              [catalogue]="catalogue()"
              [stimuli]="stimuli()"
            />
          }
          @case ('continuous') {
            <app-continuous-form
              [draft]="state.continuous"
              [populations]="populations()"
              [catalogue]="catalogue()"
              [stimuli]="stimuli()"
            />
          }
        }

        @if (review(); as check) {
          <section class="panel mt-5">
            <div class="panel-body space-y-4">
              <div class="grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,22rem)_1fr]">
                <div>
                  <label class="label" for="simulation-name">Nome (facoltativo)</label>
                  <input
                    id="simulation-name"
                    type="text"
                    class="input"
                    maxlength="255"
                    [(ngModel)]="name"
                    [placeholder]="net.name"
                  />
                  <p class="help">Senza un nome la simulazione prende quello della rete.</p>
                </div>
                <dl>
                  <dt class="label">Tempo biologico da simulare</dt>
                  <dd class="num text-base">{{ check.duration ?? 'non calcolabile' }}</dd>
                  <dd class="help">
                    @if (check.upperBound) {
                      Stima per eccesso: l'intervallo tra trial è casuale.
                    }
                    Il massimo per simulazione è {{ maxSeconds }} s.
                  </dd>
                </dl>
              </div>

              @if (check.blockers.length) {
                <div class="notice" aria-live="polite">
                  <p class="font-medium">Prima di avviare</p>
                  <ul class="mt-1 list-disc space-y-0.5 pl-5">
                    @for (blocker of check.blockers; track blocker) {
                      <li>{{ blocker }}</li>
                    }
                  </ul>
                </div>
              }
              @if (launchError(); as message) {
                <p class="notice notice-error" role="alert">{{ message }}</p>
              }
              <button
                type="button"
                class="btn btn-primary"
                [disabled]="launching() || check.blockers.length > 0"
                (click)="launch()"
              >
                {{ launching() ? 'Avvio in corso…' : 'Avvia simulazione' }}
              </button>
            </div>
          </section>
        }
      } @else if (loadError()) {
        <p class="notice notice-error" role="alert">
          {{ loadError() }} <a routerLink="/dashboard">Torna alla panoramica</a>.
        </p>
      } @else {
        <p class="text-muted">Caricamento della rete…</p>
      }
    </div>
  `,
})
export class SimulationRunnerComponent {
  private networks = inject(NetworkService);
  private simulations = inject(SimulationService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  protected readonly tabs: { mode: RunMode; label: string }[] = [
    { mode: 'builtin', label: 'Esperimento predefinito' },
    { mode: 'trials', label: 'Protocollo a trial' },
    { mode: 'continuous', label: 'Simulazione continua' },
  ];
  protected readonly builtinKinds = BUILTIN_KINDS;
  protected readonly labels = EXPERIMENT_LABELS;
  protected readonly descriptions = DESCRIPTIONS;
  protected readonly maxSeconds = MAX_SIMULATION_MS / 1000;

  protected network = signal<Network | null>(null);
  protected loadError = signal<string | null>(null);
  protected launching = signal(false);
  protected launchError = signal<string | null>(null);
  protected populations = computed(() => this.network()?.definition?.topology?.populations ?? []);
  protected neurons = computed(() => countNeurons(this.populations()).toLocaleString('it-IT'));

  // undefined durante il caricamento, null se il caricamento è fallito.
  protected catalogue = toSignal(this.networks.getModels().pipe(catchError(() => of(null))));
  protected stimuli = toSignal(inject(StimulusService).getStimuli().pipe(catchError(() => of(null))));

  /**
   * Bozze dei moduli, modificate sul posto dai componenti figli. Ogni modalità ha
   * la propria: al lancio parte solo quella attiva.
   */
  protected state = stateFromParams(history.state?.cloneParams);
  protected name = '';

  constructor() {
    const params = inject(ActivatedRoute).snapshot.paramMap;
    const networkId = params.get('networkId') ?? params.get('id') ?? '';
    this.networks
      .getNetwork(networkId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (network) => {
          this.network.set(network);
          // Senza parametri da riprendere, una rete che non può eseguire il primo
          // esperimento predefinito si apre sul protocollo generico.
          if (!history.state?.cloneParams && missingMsiPopulations(this.populations()).length) {
            this.state.mode = 'trials';
          }
        },
        error: (err) => this.loadError.set(apiErrorMessage(err, 'Rete non caricata.')),
      });
  }

  /** Durata e impedimenti al lancio per la modalità attiva. */
  protected review(): { duration: string | null; upperBound: boolean; blockers: string[] } {
    const params = buildParams(this.state);
    const kind = experimentKind(params);
    const ms = estimateDurationMs(params);
    return {
      duration: Number.isFinite(ms) && ms > 0 ? `${seconds(ms)} s` : null,
      upperBound: kind === 'cerebellum_msi_race' || (kind === 'trial_protocol' && this.state.trials.iti_random),
      blockers: validateState(this.state, { populations: this.populations(), stimuli: this.stimuli() ?? null }),
    };
  }

  protected launch(): void {
    const network = this.network();
    if (!network || this.launching() || this.review().blockers.length) return;
    this.launching.set(true);
    this.launchError.set(null);
    this.simulations
      .launchSimulation(network.id, buildParams(this.state), this.name.trim() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ simulation_id }) => this.router.navigate(['/simulations/detail', simulation_id]),
        error: (err) => {
          this.launchError.set(apiErrorMessage(err, 'Simulazione non avviata.'));
          this.launching.set(false);
        },
      });
  }
}
