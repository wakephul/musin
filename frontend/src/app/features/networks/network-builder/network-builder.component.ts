import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, catchError, debounceTime, map, of, switchMap, tap, throwError } from 'rxjs';

import { NETWORK_PRESETS, NetworkPreset, presetToPayload } from '../../../core/data/network-presets';
import { ModelInfo, Network, NetworkPayload } from '../../../core/models';
import { NetworkService } from '../../../core/services/network.service';
import { apiErrorMessage } from '../../../core/utils/errors';
import { formatNumber, plural } from '../../../core/utils/format';
import { countNeurons, countSynapses } from '../../../core/utils/topology';
import { ConfirmButtonComponent } from '../../../shared/components/confirm-button/confirm-button.component';
import { CytoscapeViewerComponent } from '../../../shared/components/cytoscape-viewer/cytoscape-viewer.component';
import { fillForm, networkForm, populationGroup, projectionGroup } from './network-form.controls';
import { NetworkFormValue, splitParams, toDraft, toFormValue, toPayload, validate } from './network-form.mapping';
import { PopulationRowComponent } from './population-row.component';
import { ProjectionRowComponent } from './projection-row.component';

const EMPTY_FORM: NetworkFormValue = { name: '', description: '', populations: [], projections: [] };

@Component({
  selector: 'app-network-builder',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ConfirmButtonComponent,
    CytoscapeViewerComponent,
    PopulationRowComponent,
    ProjectionRowComponent,
  ],
  host: { '(window:beforeunload)': 'warnBeforeUnload($event)' },
  template: `
    <div class="page">
      <p class="breadcrumb"><a routerLink="/dashboard">Panoramica</a> / {{ network() ? 'Rete' : 'Nuova rete' }}</p>

      @if (loadError(); as message) {
        <p class="notice notice-error" role="alert">{{ message }} <a routerLink="/dashboard">Torna alla panoramica</a></p>
      } @else if (loading() || catalogue() === undefined) {
        <p class="empty">Caricamento…</p>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <header class="page-header">
            <div class="min-w-0">
              <h1 class="page-title">{{ network()?.name ?? 'Nuova rete' }}</h1>
              <p class="page-subtitle">{{ summary() }}</p>
            </div>
            <div class="flex flex-col items-end gap-1">
              <div class="flex flex-wrap items-center justify-end gap-2">
                @if (network(); as saved) {
                  @if (!dirty()) {
                    <a class="btn" [routerLink]="['/simulations/run', saved.id]">Simula questa rete</a>
                  }
                  <button type="button" class="btn" [disabled]="!!problems().first || saving()" (click)="save(true)">
                    Salva come copia
                  </button>
                }
                <button
                  type="submit"
                  class="btn btn-primary"
                  [disabled]="!!problems().first || saving()"
                  [attr.aria-describedby]="problems().first ? 'save-problem' : null"
                >
                  {{ saving() ? 'Salvataggio…' : 'Salva rete' }}
                </button>
              </div>
              @if (problems().first; as problem) {
                <p id="save-problem" class="text-right text-xs text-muted">{{ problem }}</p>
              }
            </div>
          </header>

          @if (error(); as message) {
            <p class="notice notice-error mb-4" role="alert">{{ message }}</p>
          }
          @if (notice(); as message) {
            <p class="notice notice-ok mb-4" role="status">{{ message }}</p>
          }
          @if (catalogue() === null) {
            <p class="notice notice-error mb-4" role="alert">
              Elenco dei modelli non caricato: restano selezionabili solo i modelli già salvati. Ricarica la pagina per riprovare.
            </p>
          }

          <div class="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
            <div class="space-y-5">
              <section class="panel">
                <div class="panel-header"><h2 class="section-title">Parti da un modello</h2></div>
                <ul>
                  @for (preset of presets; track preset.key) {
                    <li class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
                      <div class="min-w-0 flex-1 basis-64">
                        <p class="font-medium">{{ preset.name }}</p>
                        <p class="help">{{ preset.description }}</p>
                      </div>
                      <app-confirm-button
                        label="Usa questo modello"
                        confirmLabel="Conferma sostituzione"
                        hint="Sostituisce le popolazioni e le proiezioni attuali."
                        triggerClass="btn btn-sm"
                        [needsConfirm]="value().populations.length > 0"
                        (confirmed)="usePreset(preset)"
                      />
                    </li>
                  }
                </ul>
              </section>

              <section class="panel">
                <div class="panel-header"><h2 class="section-title">Dati generali</h2></div>
                <div class="panel-body space-y-3">
                  <div>
                    <label class="label" for="network-name">Nome</label>
                    <input
                      id="network-name"
                      type="text"
                      class="input"
                      [class.border-danger]="nameProblem()"
                      formControlName="name"
                      [attr.maxlength]="255"
                      autocomplete="off"
                    />
                    @if (nameProblem()) {
                      <p class="field-error" role="alert">{{ problems().name }}</p>
                    }
                  </div>
                  <div>
                    <label class="label" for="network-description">Descrizione</label>
                    <textarea id="network-description" class="input" rows="2" formControlName="description"></textarea>
                  </div>
                </div>
              </section>

              <section class="panel">
                <div class="panel-header"><h2 class="section-title">Popolazioni</h2></div>
                @for (group of form.controls.populations.controls; track group; let i = $index) {
                  <app-population-row
                    class="border-b border-line"
                    [group]="group"
                    [index]="i"
                    [modules]="modules()"
                    [problems]="problems().populations[i]"
                    (remove)="removePopulation(i)"
                  />
                } @empty {
                  <p class="empty border-b border-line">Nessuna popolazione: aggiungine una o parti da un modello.</p>
                }
                <div class="px-4 py-3">
                  <button type="button" class="btn btn-sm" (click)="addPopulation()">Aggiungi popolazione</button>
                </div>
              </section>

              <section class="panel">
                <div class="panel-header"><h2 class="section-title">Proiezioni</h2></div>
                @for (group of form.controls.projections.controls; track group; let i = $index) {
                  <app-projection-row
                    class="border-b border-line"
                    [group]="group"
                    [index]="i"
                    [populations]="value().populations"
                    [synapses]="synapses()"
                    [problems]="problems().projections[i]"
                    (remove)="form.controls.projections.removeAt(i)"
                  />
                } @empty {
                  <p class="empty border-b border-line">Nessuna proiezione: le popolazioni non sono collegate tra loro.</p>
                }
                <div class="px-4 py-3">
                  <button type="button" class="btn btn-sm" (click)="addProjection()">Aggiungi proiezione</button>
                </div>
              </section>
            </div>

            <section class="panel order-first lg:sticky lg:top-4 lg:order-none">
              <div class="panel-header"><h2 class="section-title">Grafo</h2></div>
              <app-cytoscape-viewer [populations]="draft().populations" [projections]="draft().projections" />
            </section>
          </div>
        </form>
      }
    </div>
  `,
})
export class NetworkBuilderComponent {
  private networks = inject(NetworkService);
  private router = inject(Router);

  protected readonly presets = NETWORK_PRESETS;
  protected form = networkForm();

  /** `undefined` durante il caricamento, `null` se il catalogo non è arrivato. */
  protected catalogue = toSignal(this.networks.getModels().pipe(catchError(() => of(null))));
  protected modules = computed(() => this.catalogue()?.modules ?? []);
  protected synapses = computed(() => {
    const byId = new Map<string, ModelInfo>();
    for (const synapse of this.modules().flatMap((module) => module.synapses)) {
      if (!byId.has(synapse.id)) byId.set(synapse.id, synapse);
    }
    return [...byId.values()];
  });

  /** La rete salvata che si sta modificando; `null` per una rete nuova. */
  protected network = signal<Network | null>(null);
  protected loading = signal(true);
  protected loadError = signal<string | null>(null);
  protected saving = signal(false);
  protected error = signal<string | null>(null);
  protected notice = signal<string | null>(null);
  protected dirty = signal(false);

  protected value = signal<NetworkFormValue>(EMPTY_FORM);
  protected problems = computed(() => validate(this.value()));
  /** Ciò che mostrano grafo e riepilogo: segue il form con un ritardo, per non ridisegnare a ogni tasto. */
  protected draft = signal(toDraft(EMPTY_FORM));
  protected summary = computed(() => {
    const { populations, projections } = this.draft();
    const neurons = countNeurons(populations);
    return [
      plural(populations.length, 'popolazione', 'popolazioni'),
      plural(neurons, 'neurone', 'neuroni'),
      `${formatNumber(countSynapses(populations, projections))} sinapsi stimate`,
    ].join(' · ');
  });

  private nextKey = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.value.set(this.form.getRawValue());
      this.dirty.set(true);
      this.notice.set(null);
    });
    this.form.valueChanges
      .pipe(debounceTime(250), takeUntilDestroyed())
      .subscribe(() => this.draft.set(toDraft(this.form.getRawValue())));

    inject(ActivatedRoute)
      .paramMap.pipe(
        // Il messaggio di conferma viaggia nello stato della navigazione, leggibile solo mentre è in corso.
        map((params) => ({ id: params.get('id'), notice: this.navigationNotice() })),
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
          this.error.set(null);
        }),
        switchMap(({ id, notice }) => {
          const network: Observable<Network | null> = id ? this.networks.getNetwork(id) : of(null);
          return network.pipe(
            map((loaded) => ({ network: loaded, notice })),
            catchError((err) => {
              this.loadError.set(apiErrorMessage(err, 'Rete non caricata.'));
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ network, notice }) => this.show(network, notice));
  }

  /** Letto dalla guardia di uscita in app.routes.ts. */
  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  /** Chiusura o ricaricamento della scheda: il browser chiede conferma con un testo suo. */
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty()) return;
    event.preventDefault();
    // Richiesto dai browser che non considerano preventDefault.
    event.returnValue = true;
  }

  protected nameProblem(): boolean {
    return this.form.controls.name.touched && !!this.problems().name;
  }

  protected addPopulation(): void {
    this.form.controls.populations.push(
      populationGroup({ key: this.nextKey++, id: '', size: 100, neuron_model: '', params: '{}' }),
    );
  }

  protected removePopulation(index: number): void {
    const { populations, projections } = this.form.controls;
    const key = populations.at(index).controls.key.value;
    for (const { controls } of projections.controls) {
      if (controls.source.value === key) controls.source.setValue(null, { emitEvent: false });
      if (controls.target.value === key) controls.target.setValue(null, { emitEvent: false });
    }
    populations.removeAt(index);
  }

  protected addProjection(): void {
    const synapse = this.synapses().find((model) => model.id === 'static_synapse');
    this.form.controls.projections.push(
      projectionGroup({
        source: null,
        target: null,
        rule: 'all_to_all',
        synapse_model: synapse?.id ?? '',
        ...splitParams('all_to_all', synapse?.default_params ?? {}),
      }),
    );
  }

  protected usePreset(preset: NetworkPreset): void {
    const fromPreset = toFormValue(presetToPayload(preset));
    const { name, description } = this.form.getRawValue();
    // Nome e descrizione già scritti restano: il modello riempie solo quelli vuoti.
    this.replaceForm({
      ...fromPreset,
      name: name.trim() ? name : fromPreset.name,
      description: description.trim() ? description : fromPreset.description,
    });
  }

  protected save(asCopy = false): void {
    if (this.problems().first || this.saving()) return;
    const current = this.network();
    const payload = toPayload(this.form.getRawValue(), current?.definition?.params ?? {});
    const request = !current
      ? this.networks.createNetwork(payload)
      : asCopy
        ? this.saveCopy(current, payload)
        : this.networks.updateNetwork(current.id, payload);

    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        // Prima di navigare: la guardia di uscita non deve chiedere conferma per modifiche appena salvate.
        this.dirty.set(false);
        if (saved.id === current?.id) {
          this.network.set(saved);
          this.notice.set('Rete salvata.');
        } else if (!this.destroyed) {
          this.router.navigate(['/networks', saved.id], {
            replaceUrl: !current,
            state: { notice: asCopy ? 'Copia salvata.' : 'Rete salvata.' },
          });
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(apiErrorMessage(err, 'Rete non salvata.'));
      },
    });
  }

  /** La copia nasce sul server con `forkNetwork`, che ne registra l'origine, e poi riceve il contenuto del form. */
  private saveCopy(original: Network, payload: NetworkPayload): Observable<Network> {
    const name = `${payload.name} (copia)`;
    return this.networks.forkNetwork(original.id, name).pipe(
      switchMap((copy) =>
        this.networks.updateNetwork(copy.id, { ...payload, name }).pipe(
          // Senza le modifiche la copia sarebbe un doppione dell'originale: si toglie e si mostra l'errore.
          catchError((err) =>
            this.networks.deleteNetwork(copy.id).pipe(
              catchError(() => of(undefined)),
              switchMap(() => throwError(() => err)),
            ),
          ),
        ),
      ),
    );
  }

  private show(network: Network | null, notice: string | null): void {
    this.network.set(network);
    this.replaceForm(network ? toFormValue(network) : EMPTY_FORM);
    this.form.markAsUntouched();
    this.dirty.set(false);
    this.notice.set(notice);
    this.loading.set(false);
  }

  /** Un contenuto caricato per intero si disegna subito, senza aspettare il ritardo. */
  private replaceForm(value: NetworkFormValue): void {
    fillForm(this.form, value);
    this.nextKey = value.populations.length;
    this.draft.set(toDraft(value));
  }

  private navigationNotice(): string | null {
    const notice: unknown = this.router.getCurrentNavigation()?.extras.state?.['notice'];
    return typeof notice === 'string' ? notice : null;
  }
}
