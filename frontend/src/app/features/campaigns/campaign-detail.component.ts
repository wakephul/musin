import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';

import {
  Campaign,
  CampaignGroup,
  CampaignSummary,
  EXPERIMENT_LABELS,
  OWN_NETWORK_LABEL,
  ReferenceSet,
  STATUS_CLASSES,
  STATUS_LABELS,
  simulatesSelectedNetwork,
} from '../../core/models';
import { CampaignService } from '../../core/services/campaign.service';
import { apiErrorMessage } from '../../core/utils/errors';
import { formatNumber } from '../../core/utils/format';
import { ConfirmButtonComponent } from '../../shared/components/confirm-button/confirm-button.component';
import {
  CONDITION_LABELS,
  campaignState,
  chartSeries,
  countsText,
  differenceText,
  isActive,
  medianText,
  pText,
  seedsText,
  sweepLabel,
  totalOf,
  valueText,
} from './campaign-helpers';
import { PercentileChartComponent } from './percentile-chart.component';

const REFRESH_MS = 5000;

@Component({
  selector: 'app-campaign-detail',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, ConfirmButtonComponent, PercentileChartComponent],
  template: `
    <div class="page">
      <p class="breadcrumb">
        <a routerLink="/dashboard">Panoramica</a> / Campagna
        <span class="num">#{{ id }}</span>
      </p>

      @if (gone(); as message) {
        <p class="notice" role="alert">{{ message }} <a routerLink="/dashboard">Torna alla panoramica</a></p>
      } @else if (loadError()) {
        <div class="notice notice-error flex flex-wrap items-center gap-3" role="alert">
          <span>{{ loadError() }}</span>
          <button type="button" class="btn btn-sm" (click)="load()">Riprova</button>
        </div>
      } @else {
        @if (campaign(); as c) {
          <header class="page-header">
            <div>
              <h1 class="page-title">
                Campagna <span class="num">#{{ c.id }}</span>
              </h1>
              @if (c.name && c.name !== c.network_name) {
                <p class="page-subtitle">{{ c.name }}</p>
              }
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              @if (active()) {
                <app-confirm-button
                  label="Interrompi"
                  confirmLabel="Conferma interruzione"
                  hint="Le simulazioni già completate restano."
                  [disabled]="busy()"
                  (confirmed)="abort()"
                />
              }
              <app-confirm-button
                label="Elimina"
                confirmLabel="Conferma eliminazione"
                hint="Elimina la campagna con tutte le sue simulazioni e i risultati."
                [disabled]="busy()"
                (confirmed)="remove()"
              />
            </div>
          </header>

          <div class="space-y-5">
            @if (actionError()) {
              <p class="notice notice-error" role="alert">
                {{ actionError() }}
              </p>
            }

            <dl class="panel grid grid-cols-2 gap-x-6 gap-y-3 p-4 lg:grid-cols-4">
              <div>
                <dt class="label">Esperimento</dt>
                <dd>{{ experimentLabels[c.experiment] || c.experiment }}</dd>
              </div>
              <div>
                <dt class="label">Rete</dt>
                <dd>
                  @if (simulatesNetwork(c)) {
                    <a [routerLink]="['/networks', c.network_id]">{{ c.network_name || 'Rete #' + c.network_id }}</a>
                  } @else {
                    {{ ownNetworkLabel }}
                  }
                </dd>
              </div>
              <div>
                <dt class="label">Avviata</dt>
                <dd class="num">
                  {{ c.created_at | date: 'dd/MM/yyyy HH:mm' }}
                </dd>
              </div>
              <div>
                <dt class="label">Stato</dt>
                <dd>
                  <span [class]="state().className">{{ state().label }}</span>
                </dd>
              </div>
              <div>
                <dt class="label">Seed</dt>
                <dd class="num">{{ seeds() }}</dd>
              </div>
              <div class="col-span-2">
                <dt class="label">Parametro che varia</dt>
                @if (c.sweep; as sweep) {
                  <dd>
                    {{ sweepName() }}:
                    <span class="num">{{ sweepValues() }}</span>
                  </dd>
                } @else {
                  <dd class="text-muted">nessuno</dd>
                }
              </div>
              <div>
                <dt class="label">Tempo biologico</dt>
                <dd class="num">{{ duration() }} s</dd>
              </div>
            </dl>

            @if (active()) {
              <div class="panel panel-body space-y-2">
                <div class="flex items-baseline justify-between gap-3 text-sm">
                  <span role="status">{{ counts() }}</span>
                  <span class="num">{{ done() }} di {{ total() }}</span>
                </div>
                <div
                  class="progress"
                  role="progressbar"
                  aria-label="Simulazioni concluse"
                  aria-valuemin="0"
                  [attr.aria-valuemax]="total()"
                  [attr.aria-valuenow]="done()"
                >
                  <span [style.width.%]="(100 * done()) / total()"></span>
                </div>
                <p class="help">
                  Il simulatore esegue una simulazione alla volta. I risultati si aggiornano a ogni simulazione completata.
                </p>
              </div>
            } @else {
              <p class="text-sm text-muted">{{ counts() }}.</p>
            }

            <section class="panel" aria-labelledby="results-title">
              <div class="panel-header">
                <h2 id="results-title" class="section-title">Tempi di risposta</h2>
                @if (summary()?.completed; as completed) {
                  <span class="text-sm text-muted">su {{ completedText(completed) }}</span>
                }
              </div>

              @if (summaryError()) {
                <div class="notice notice-error m-4 flex flex-wrap items-center gap-3" role="alert">
                  <span>{{ summaryError() }}</span>
                  <button type="button" class="btn btn-sm" (click)="loadSummary()">Riprova</button>
                </div>
              } @else if (!summary()) {
                <p class="empty" role="status">Caricamento…</p>
              } @else if (!summary()!.completed) {
                <p class="empty">Nessuna simulazione completata: i tempi di risposta compaiono dopo la prima.</p>
              } @else if (!hasGroups()) {
                <p class="empty">
                  Questo esperimento non produce tempi di risposta per condizione. I risultati sono nelle singole simulazioni, qui
                  sotto.
                </p>
              } @else {
                <div class="panel-body space-y-5">
                  <div class="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,24rem)_1fr]">
                    <div>
                      <label class="label" for="reference">Confronta con</label>
                      <select
                        id="reference"
                        class="input"
                        [ngModel]="c.reference ?? ''"
                        [disabled]="busy()"
                        (ngModelChange)="setReference($event || null)"
                      >
                        <option value="">Nessun confronto</option>
                        @for (set of references(); track set.key) {
                          <option [value]="set.key">{{ set.name }}</option>
                        }
                      </select>
                      @if (selectedReference(); as set) {
                        <p class="help">
                          {{ set.source || 'Set caricato da te.' }}
                          Tempi per condizione:
                          <span class="num">{{ referenceSizes(set) }}</span
                          >.
                        </p>
                        @if (set.deletable) {
                          <app-confirm-button
                            label="Elimina questo set"
                            confirmLabel="Conferma eliminazione"
                            [disabled]="busy()"
                            (confirmed)="deleteReference(set)"
                          />
                        }
                      }
                    </div>
                    <details class="self-start">
                      <summary class="cursor-pointer text-sm text-accent">Carica un set di riferimento</summary>
                      <div class="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
                        <div>
                          <label class="label" for="reference-name">Nome</label>
                          <input id="reference-name" type="text" class="input" maxlength="255" [(ngModel)]="uploadName" />
                        </div>
                        <div>
                          <label class="label" for="reference-file">File</label>
                          <input
                            id="reference-file"
                            type="file"
                            class="block w-full text-sm"
                            accept=".csv,text/csv,text/plain"
                            (change)="pickFile($event)"
                          />
                        </div>
                        <p class="help sm:col-span-2">
                          CSV con due colonne: condizione (<span class="num">A</span>, <span class="num">V</span>,
                          <span class="num">AV</span>, <span class="num">race</span>) e tempo di risposta in ms. Massimo 2 MB.
                        </p>
                        <div class="sm:col-span-2">
                          <button
                            type="button"
                            class="btn"
                            [disabled]="busy() || !uploadFile() || !uploadName.trim()"
                            (click)="uploadReference()"
                          >
                            Carica e confronta
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                  @if (referenceError()) {
                    <p class="notice notice-error" role="alert">
                      {{ referenceError() }}
                    </p>
                  }

                  @if (c.sweep) {
                    <div class="overflow-x-auto rounded-md border border-line">
                      <table class="table-list">
                        <caption class="px-4 py-2 text-left text-xs text-muted">
                          Mediana in ms per valore di
                          {{
                            sweepName()
                          }}, con l'intervallo di confidenza al 95%.
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{{ sweepName() }}</th>
                            @for (label of overviewLabels(); track label) {
                              <th scope="col" class="text-right">
                                {{ conditionLabels[label] || label }}
                              </th>
                            }
                            <th scope="col">Violazione</th>
                            <th scope="col">
                              <span class="sr-only">Dettaglio</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of overview(); track row.value) {
                            <tr>
                              <td class="num">{{ row.valueText }}</td>
                              @for (cell of row.cells; track $index) {
                                <td class="num whitespace-nowrap text-right">
                                  {{ cell }}
                                </td>
                              }
                              <td class="whitespace-nowrap">
                                {{ row.violation }}
                              </td>
                              <td class="text-right">
                                @if (row.value === point()?.value) {
                                  <span class="text-xs text-muted">mostrato sotto</span>
                                } @else {
                                  <button type="button" class="btn btn-quiet btn-sm" (click)="selectedValue.set(row.value)">
                                    Dettaglio
                                  </button>
                                }
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }

                  @for (group of point()?.groups ?? []; track group.population) {
                    <article class="space-y-4">
                      <h3 class="subsection-title">
                        <span [class.num]="!group.population.includes(' ')">{{ group.population }}</span>
                        @if (c.sweep) {
                          <span class="font-normal text-muted">
                            , {{ sweepName() }} <span class="num">{{ valueOf(point()!.value) }}</span></span
                          >
                        }
                      </h3>
                      <div class="space-y-4">
                        <div class="space-y-3">
                          <div class="overflow-x-auto rounded-md border border-line">
                            <table class="table-list">
                              <thead>
                                <tr>
                                  <th scope="col">Condizione</th>
                                  <th scope="col" class="text-right">Trial</th>
                                  <th scope="col" class="text-right">Risposte</th>
                                  <th scope="col" class="text-right">Mediana (IC 95%), ms</th>
                                  @if (hasReference(group)) {
                                    <th scope="col" class="text-right">Riferimento, ms</th>
                                    <th scope="col" class="text-right">Differenza (IC 95%), ms</th>
                                  }
                                </tr>
                              </thead>
                              <tbody>
                                @for (row of group.conditions; track row.label) {
                                  <tr>
                                    <td>
                                      {{ conditionLabels[row.label] || row.label }}
                                    </td>
                                    <td class="num text-right">
                                      {{ row.trials === null ? '' : row.trials }}
                                    </td>
                                    <td class="num text-right">
                                      {{ row.responses }}
                                    </td>
                                    <td class="num whitespace-nowrap text-right">
                                      {{ median(row.median_ms, row.ci95_ms) }}
                                    </td>
                                    @if (hasReference(group)) {
                                      @if (row.reference; as reference) {
                                        <td class="num whitespace-nowrap text-right">
                                          {{ median(reference.median_ms, null) }}
                                          <span class="text-muted">(n = {{ reference.responses }})</span>
                                        </td>
                                        <td
                                          class="num whitespace-nowrap text-right"
                                          [class.font-semibold]="reference.comparison?.differs"
                                        >
                                          {{ difference(reference.comparison) }}
                                        </td>
                                      } @else {
                                        <td class="text-right text-muted">non nel set</td>
                                        <td></td>
                                      }
                                    }
                                  </tr>
                                }
                              </tbody>
                            </table>
                          </div>
                          @if (hasReference(group)) {
                            <p class="help">
                              Differenza: simulato meno riferimento. In grassetto quelle il cui intervallo non contiene lo zero.
                            </p>
                          }
                          @if (group.rmi; as rmi) {
                            <p>
                              Violazione della disuguaglianza del modello a gara:
                              <strong>{{ rmi.significant ? 'sì' : 'no' }}</strong>
                              <span class="num"> ({{ rmiDetail(rmi) }})</span>
                            </p>
                          } @else {
                            <p class="text-sm text-muted">
                              Disuguaglianza del modello a gara non calcolata: serve almeno una risposta in ciascuna delle
                              condizioni V, A e AV.
                            </p>
                          }
                          @if (group.percentiles_av_faster_than_race !== null) {
                            <p class="text-sm">
                              Audiovisivo più veloce del modello a gara a
                              <span class="num">{{ group.percentiles_av_faster_than_race }}</span>
                              percentili su
                              <span class="num">{{ group.percentile_levels.length }}</span
                              >.
                            </p>
                          }
                          @if (group.note) {
                            <p class="help">{{ group.note }}</p>
                          }
                          <p class="help">
                            Tempi di
                            {{ simulationsText(group.simulations) }} messi insieme. Intervalli di confidenza al 95% per
                            ricampionamento, 2000 volte, delle simulazioni e dei trial di ciascuna.
                          </p>
                        </div>
                        <app-percentile-chart
                          class="max-w-3xl"
                          [levels]="group.percentile_levels"
                          [series]="series(group)"
                          [label]="'Tempi di risposta ai percentili, ' + group.population"
                        />
                      </div>

                      <details class="rounded-md border border-line">
                        <summary>Mediane per simulazione</summary>
                        <div class="overflow-x-auto border-t border-line">
                          <table class="table-list">
                            <thead>
                              <tr>
                                <th scope="col">Simulazione</th>
                                <th scope="col" class="text-right">Seed</th>
                                @for (row of group.conditions; track row.label) {
                                  <th scope="col" class="text-right">
                                    {{ conditionLabels[row.label] || row.label }}
                                  </th>
                                }
                              </tr>
                            </thead>
                            <tbody>
                              @for (entry of group.per_simulation; track entry.simulation_id) {
                                <tr>
                                  <td>
                                    <a class="num" [routerLink]="['/simulations/detail', entry.simulation_id]"
                                      >#{{ entry.simulation_id }}</a
                                    >
                                  </td>
                                  <td class="num text-right">
                                    {{ entry.seed ?? 'n.d.' }}
                                  </td>
                                  @for (row of group.conditions; track row.label) {
                                    <td class="num text-right">
                                      {{ median(entry.median_ms[row.label] ?? null, null) }}
                                    </td>
                                  }
                                </tr>
                              }
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </article>
                  }
                </div>
              }
            </section>

            <section class="panel" aria-labelledby="members-title">
              <div class="panel-header">
                <h2 id="members-title" class="section-title">Simulazioni</h2>
              </div>
              <div class="overflow-x-auto">
                <table class="table-list">
                  <thead>
                    <tr>
                      <th scope="col">ID</th>
                      <th scope="col" class="text-right">Seed</th>
                      @if (c.sweep) {
                        <th scope="col" class="text-right">
                          {{ sweepName() }}
                        </th>
                      }
                      <th scope="col">Stato</th>
                      <th scope="col"><span class="sr-only">Azioni</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (member of c.simulations; track member.id) {
                      <tr>
                        <td class="num text-muted">{{ member.id }}</td>
                        <td class="num text-right">
                          {{ member.seed ?? 'n.d.' }}
                        </td>
                        @if (c.sweep) {
                          <td class="num text-right">
                            {{ valueOf(member.value) }}
                          </td>
                        }
                        <td class="w-full">
                          <span [class]="statusClass[member.status]">{{ statusLabels[member.status] }}</span>
                          @if (member.status === 'FAILED' && member.error_message) {
                            <div class="max-w-[28rem] truncate text-xs text-muted" [title]="member.error_message">
                              {{ member.error_message }}
                            </div>
                          }
                        </td>
                        <td class="text-right">
                          <a class="btn btn-sm" [routerLink]="['/simulations/detail', member.id]">Apri</a>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        } @else {
          <p class="text-muted" role="status">Caricamento della campagna…</p>
        }
      }
    </div>
  `,
})
export class CampaignDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private campaigns = inject(CampaignService);
  private destroyRef = inject(DestroyRef);

  protected readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly statusClass = STATUS_CLASSES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly ownNetworkLabel = OWN_NETWORK_LABEL;
  protected readonly experimentLabels: Record<string, string> = EXPERIMENT_LABELS;
  protected readonly conditionLabels = CONDITION_LABELS;
  protected readonly median = medianText;
  protected readonly difference = differenceText;
  protected readonly valueOf = valueText;
  protected readonly series = chartSeries;

  protected campaign = signal<Campaign | null>(null);
  protected summary = signal<CampaignSummary | null>(null);
  protected references = signal<ReferenceSet[]>([]);
  protected loadError = signal<string | null>(null);
  protected summaryError = signal<string | null>(null);
  protected actionError = signal<string | null>(null);
  protected referenceError = signal<string | null>(null);
  /** Messaggio quando la campagna non esiste più (404). */
  protected gone = signal<string | null>(null);
  protected busy = signal(false);
  /** Valore del parametro variabile mostrato in dettaglio; il primo finché non se ne sceglie uno. */
  protected selectedValue = signal<number | null>(null);
  protected uploadFile = signal<File | null>(null);
  protected uploadName = '';

  protected readonly active = computed(() => !!this.campaign() && isActive(this.campaign()!.counts));
  protected readonly state = computed(() => campaignState(this.campaign()!.counts));
  protected readonly counts = computed(() => countsText(this.campaign()!.counts));
  protected readonly total = computed(() => totalOf(this.campaign()!.counts));
  protected readonly done = computed(() => {
    const counts = this.campaign()!.counts;
    return counts.COMPLETED + counts.FAILED + counts.ABORTED;
  });
  protected readonly seeds = computed(() => seedsText(this.campaign()!.seeds));
  protected readonly sweepName = computed(() => sweepLabel(this.campaign()!) ?? '');
  protected readonly sweepValues = computed(() => (this.campaign()!.sweep?.values ?? []).map(valueText).join(', '));
  protected readonly duration = computed(() => formatNumber(this.campaign()!.duration_ms / 1000, 1, 0));
  protected readonly selectedReference = computed(
    () => this.references().find((set) => set.key === this.campaign()?.reference) ?? null,
  );

  protected readonly hasGroups = computed(() => (this.summary()?.points ?? []).some((point) => point.groups.length > 0));
  protected readonly point = computed<CampaignSummary['points'][number] | null>(() => {
    const points = this.summary()?.points ?? [];
    return points.find((point) => point.value === this.selectedValue()) ?? points[0] ?? null;
  });

  /** Condizioni presenti in almeno un valore, nell'ordine del primo gruppo. */
  protected readonly overviewLabels = computed(() => {
    const labels: string[] = [];
    for (const point of this.summary()?.points ?? []) {
      for (const row of point.groups[0]?.conditions ?? []) if (!labels.includes(row.label)) labels.push(row.label);
    }
    return labels;
  });
  /** Una riga per valore del parametro, con le mediane della prima popolazione. */
  protected readonly overview = computed(() =>
    (this.summary()?.points ?? []).map((point) => {
      const group = point.groups[0];
      const rows = new Map((group?.conditions ?? []).map((row) => [row.label, row]));
      return {
        value: point.value,
        valueText: valueText(point.value),
        cells: this.overviewLabels().map((label) => {
          const row = rows.get(label);
          return row ? medianText(row.median_ms, row.ci95_ms) : '';
        }),
        violation: group?.rmi ? `${group.rmi.significant ? 'sì' : 'no'} (${this.rmiDetail(group.rmi)})` : 'non calcolata',
      };
    }),
  );

  private refresh?: Subscription;

  constructor() {
    this.load();
    this.campaigns
      .getReferenceSets()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (sets) => this.references.set(sets),
        error: () => this.references.set([]),
      });
  }

  /** Carica la campagna; finché è attiva la rilegge ogni 5 s e aggiorna il riepilogo quando ne finisce una. */
  protected load(): void {
    this.refresh?.unsubscribe();
    this.loadError.set(null);
    this.refresh = timer(0, REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetch());
  }

  private fetch(): void {
    this.campaigns
      .getCampaign(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (campaign) => {
          this.campaign.set(campaign);
          if (!isActive(campaign.counts)) this.refresh?.unsubscribe();
          if (this.summary()?.completed !== campaign.counts.COMPLETED || this.summary()?.reference !== campaign.reference) {
            this.loadSummary();
          }
        },
        error: (err) => {
          if (err instanceof HttpErrorResponse && err.status === 404) {
            this.refresh?.unsubscribe();
            this.gone.set(this.campaign() ? 'La campagna è stata eliminata.' : 'Campagna non trovata.');
          } else if (!this.campaign()) {
            // Con la campagna già a schermo un errore passeggero non la sostituisce: il prossimo giro riprova.
            this.refresh?.unsubscribe();
            this.loadError.set(apiErrorMessage(err, 'Campagna non caricata.'));
          }
        },
      });
  }

  protected loadSummary(): void {
    this.summaryError.set(null);
    this.campaigns
      .getSummary(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => this.summary.set(summary),
        error: (err) => this.summaryError.set(apiErrorMessage(err, 'Tempi di risposta non caricati.')),
      });
  }

  protected simulatesNetwork(campaign: Campaign): boolean {
    return simulatesSelectedNetwork(campaign.experiment);
  }

  protected hasReference(group: CampaignGroup): boolean {
    return group.conditions.some((row) => !!row.reference);
  }

  protected completedText(completed: number): string {
    return completed === 1 ? '1 simulazione completata' : `${completed} simulazioni completate`;
  }

  protected simulationsText(count: number): string {
    return count === 1 ? '1 simulazione' : `${count} simulazioni`;
  }

  protected referenceSizes(set: ReferenceSet): string {
    return Object.entries(set.responses)
      .map(([label, count]) => `${label} ${formatNumber(count)}`)
      .join(', ');
  }

  protected rmiDetail(rmi: { max_violation: number; p_value: number | null }): string {
    const maximum = `massimo ${formatNumber(rmi.max_violation, 2, 2)}`;
    return rmi.p_value === null ? `${maximum}, troppo pochi trial per il test` : `${maximum}, ${pText(rmi.p_value)}`;
  }

  protected setReference(reference: string | null): void {
    this.referenceError.set(null);
    this.busy.set(true);
    this.campaigns
      .setReference(this.id, reference)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (campaign) => {
          this.campaign.set(campaign);
          this.busy.set(false);
          this.loadSummary();
        },
        error: (err) => {
          this.referenceError.set(apiErrorMessage(err, 'Confronto non impostato.'));
          this.busy.set(false);
        },
      });
  }

  protected pickFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.uploadFile.set(file);
    if (file && !this.uploadName.trim()) this.uploadName = file.name.replace(/\.[^.]+$/, '');
  }

  protected uploadReference(): void {
    const file = this.uploadFile();
    if (!file) return;
    this.referenceError.set(null);
    this.busy.set(true);
    this.campaigns
      .uploadReferenceSet(this.uploadName.trim(), file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (set) => {
          this.references.update((sets) => [...sets, set]);
          this.uploadName = '';
          this.uploadFile.set(null);
          this.setReference(set.key);
        },
        error: (err) => {
          this.referenceError.set(apiErrorMessage(err, 'Set di riferimento non caricato.'));
          this.busy.set(false);
        },
      });
  }

  protected deleteReference(set: ReferenceSet): void {
    this.referenceError.set(null);
    this.busy.set(true);
    this.campaigns
      .deleteReferenceSet(set.key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.references.update((sets) => sets.filter((entry) => entry.key !== set.key));
          this.busy.set(false);
          // Il server ha tolto il confronto dalla campagna: si rilegge tutto.
          this.load();
        },
        error: (err) => {
          this.referenceError.set(apiErrorMessage(err, 'Set di riferimento non eliminato.'));
          this.busy.set(false);
        },
      });
  }

  protected abort(): void {
    this.actionError.set(null);
    this.busy.set(true);
    this.campaigns
      .abortCampaign(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.load();
        },
        error: (err) => {
          this.actionError.set(apiErrorMessage(err, 'Campagna non interrotta.'));
          this.busy.set(false);
        },
      });
  }

  protected remove(): void {
    this.actionError.set(null);
    this.busy.set(true);
    this.refresh?.unsubscribe();
    this.campaigns
      .deleteCampaign(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.router.navigate(['/dashboard']),
        error: (err) => {
          this.actionError.set(apiErrorMessage(err, 'Campagna non eliminata.'));
          this.busy.set(false);
          this.load();
        },
      });
  }
}
