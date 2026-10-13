import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ModelCatalogue, Population, Stimulus } from '../../../core/models';
import { DifferentialPlotsComponent } from './differential-plots.component';
import { ConditionDraft, DeviceDraft, TrialProtocolDraft } from './experiment-params';
import { SEED, TRIAL_META, RESOLUTION } from './experiment-validation';
import { InputsEditorComponent } from './inputs-editor.component';
import { ParamFieldComponent } from './param-field.component';

@Component({
  selector: 'app-trial-protocol-form',
  standalone: true,
  imports: [FormsModule, InputsEditorComponent, DifferentialPlotsComponent, ParamFieldComponent],
  host: { class: 'block space-y-5' },
  template: `
    <app-inputs-editor
      [inputs]="draft().inputs"
      [populations]="populations()"
      [catalogue]="catalogue()"
      [stimuli]="stimuli()"
      hint="Un dispositivo è attivo solo durante lo stimolo dei trial la cui condizione lo include."
    />

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="section-title">Condizioni</h2>
          <p class="help">
            A ogni trial viene estratta una condizione, con probabilità proporzionale al peso. Una condizione senza
            dispositivi è un catch trial.
          </p>
        </div>
        <button type="button" class="btn btn-sm" (click)="addCondition()">Aggiungi condizione</button>
      </div>
      @for (condition of draft().conditions; track condition; let i = $index) {
        <div class="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
          <div class="w-28">
            <label class="label" [for]="'condition-' + i + '-label'">Etichetta</label>
            <input
              type="text"
              class="input num"
              [id]="'condition-' + i + '-label'"
              [(ngModel)]="condition.condition_label"
              placeholder="es. AV"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
            />
          </div>
          <fieldset class="min-w-48 flex-1">
            <legend class="label">Dispositivi attivi</legend>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 text-sm">
              @for (device of draft().inputs.devices; track device) {
                <label class="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    class="checkbox"
                    [checked]="condition.devices.includes(device)"
                    (change)="toggleDevice(condition, device)"
                  />
                  <span class="num">{{ device.id || 'senza ID' }}</span>
                </label>
              } @empty {
                <span class="text-muted">Nessun dispositivo definito.</span>
              }
              @if (isCatch(condition)) {
                <span class="tag">catch trial</span>
              }
            </div>
          </fieldset>
          <app-param-field
            class="w-24"
            [fieldId]="'condition-' + i + '-weight'"
            [meta]="meta.weight"
            [(value)]="condition.weight"
          />
          <div class="w-20">
            <span class="label">Probabilità</span>
            <p class="num py-1.5 text-sm">{{ probability(condition) }}</p>
          </div>
          <div class="w-52">
            <label class="label" [for]="'condition-' + i + '-winner'">Risposta attesa</label>
            <select class="input" [id]="'condition-' + i + '-winner'" [(ngModel)]="condition.expected_winner">
              <option [ngValue]="null">Nessuna risposta attesa</option>
              @for (population of populations(); track population.id) {
                <option [ngValue]="population.id">{{ population.id }}</option>
              }
            </select>
          </div>
          <button type="button" class="btn btn-quiet btn-sm ml-auto mt-5" (click)="removeCondition(condition)">
            Rimuovi
          </button>
        </div>
      } @empty {
        <p class="empty">Nessuna condizione. Aggiungine una per stabilire quali dispositivi sono attivi nei trial.</p>
      }
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2 class="section-title">Trial</h2>
      </div>
      <div class="panel-body space-y-4">
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <app-param-field fieldId="trial-count" [meta]="meta.num_trials" [(value)]="draft().num_trials" />
          <app-param-field fieldId="trial-duration" [meta]="meta.trial_duration_ms" [(value)]="draft().trial_duration_ms" />
          <app-param-field
            fieldId="trial-stimulus"
            [meta]="meta.stimulus_duration_ms"
            [(value)]="draft().stimulus_duration_ms"
          />
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          @if (draft().iti_random) {
            <app-param-field fieldId="trial-iti-min" [meta]="meta.iti_min_ms" [(value)]="draft().iti_range_ms[0]" />
            <app-param-field fieldId="trial-iti-max" [meta]="meta.iti_max_ms" [(value)]="draft().iti_range_ms[1]" />
          } @else {
            <app-param-field fieldId="trial-iti" [meta]="meta.iti_ms" [(value)]="draft().iti_ms" />
          }
          <label class="col-span-2 mt-5 inline-flex items-center gap-2 py-1.5 text-sm">
            <input type="checkbox" class="checkbox" [(ngModel)]="draft().iti_random" />
            Intervallo casuale, uniforme tra minimo e massimo
          </label>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <app-param-field fieldId="trial-seed" [meta]="seedMeta" [(value)]="draft().seed" />
          <app-param-field fieldId="trial-resolution" [meta]="resolutionMeta" [(value)]="draft().resolution" />
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2 class="section-title">Analisi</h2>
      </div>
      <div class="panel-body space-y-5">
        <app-differential-plots
          [plots]="draft().differential_plots"
          [populations]="populations()"
          hint="Per ogni coppia: differenza di frequenza A − B nel tempo e, per ogni trial, la popolazione con più spike. L'accuratezza conta i trial la cui condizione ha A o B come risposta attesa."
        />
        <div class="grid grid-cols-2 gap-x-4 md:grid-cols-3">
          <app-param-field fieldId="decision-margin" [meta]="meta.decision_margin" [(value)]="draft().decision_margin" />
        </div>

        <div>
          <label class="subsection-title inline-flex items-center gap-2">
            <input type="checkbox" class="checkbox" [(ngModel)]="draft().response_cdf.enabled" />
            Distribuzione dei tempi di risposta
          </label>
          <p class="help">
            Per ogni coppia differenziale il tempo di risposta di un trial è il primo istante in cui la differenza di
            frequenza tra A e B supera la soglia, in un verso o nell'altro.
          </p>
          @if (draft().response_cdf.enabled) {
            <div class="mt-3 grid grid-cols-2 gap-x-4 md:grid-cols-4">
              <app-param-field fieldId="cdf-threshold" [meta]="meta.threshold" [(value)]="draft().response_cdf.threshold" />
              <app-param-field fieldId="cdf-bin" [meta]="meta.bin_size" [(value)]="draft().response_cdf.bin_size" />
            </div>
          }
        </div>

        <div>
          <label class="subsection-title inline-flex items-center gap-2">
            <input type="checkbox" class="checkbox" [(ngModel)]="draft().race_model.enabled" />
            Race Model Inequality
          </label>
          <p class="help">
            Confronta la distribuzione cumulativa della latenza del primo spike nei trial AV con la somma di quelle dei
            trial V e A (Miller 1982). Richiede condizioni con etichetta esattamente <span class="num">V</span>,
            <span class="num">A</span> e <span class="num">AV</span>.
          </p>
          @if (draft().race_model.enabled) {
            <fieldset class="mt-3">
              <legend class="label">Popolazioni su cui calcolarla</legend>
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                @for (id of raceOptions(); track id) {
                  <label class="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      class="checkbox"
                      [checked]="draft().race_model.populations.includes(id)"
                      (change)="toggleRacePopulation(id)"
                    />
                    <span class="num">{{ id }}</span>
                  </label>
                }
              </div>
            </fieldset>
          }
        </div>
      </div>
    </section>
  `,
})
export class TrialProtocolFormComponent {
  /** Bozza del protocollo, modificata sul posto. */
  readonly draft = input.required<TrialProtocolDraft>();
  readonly populations = input.required<Population[]>();
  readonly catalogue = input.required<ModelCatalogue | null | undefined>();
  readonly stimuli = input.required<Stimulus[] | null | undefined>();

  protected readonly meta = TRIAL_META;
  protected readonly seedMeta = SEED;
  protected readonly resolutionMeta = RESOLUTION;

  protected addCondition(): void {
    this.draft().conditions.push({ condition_label: '', devices: [], weight: 1, expected_winner: null });
  }

  protected removeCondition(condition: ConditionDraft): void {
    const draft = this.draft();
    draft.conditions = draft.conditions.filter((item) => item !== condition);
  }

  protected toggleDevice(condition: ConditionDraft, device: DeviceDraft): void {
    condition.devices = condition.devices.includes(device)
      ? condition.devices.filter((item) => item !== device)
      : [...condition.devices, device];
  }

  protected isCatch(condition: ConditionDraft): boolean {
    return !this.draft().inputs.devices.some((device) => condition.devices.includes(device));
  }

  protected probability(condition: ConditionDraft): string {
    const total = this.draft().conditions.reduce((sum, item) => sum + Math.max(Number(item.weight) || 0, 0), 0);
    return total > 0 ? `${Math.round((100 * Math.max(Number(condition.weight) || 0, 0)) / total)} %` : '';
  }

  /** Popolazioni della rete, più quelle selezionate in una simulazione precedente e non più presenti. */
  protected raceOptions(): string[] {
    const ids = this.populations().map((population) => population.id);
    return [...ids, ...this.draft().race_model.populations.filter((id) => !ids.includes(id))];
  }

  protected toggleRacePopulation(id: string): void {
    const race = this.draft().race_model;
    race.populations = race.populations.includes(id)
      ? race.populations.filter((item) => item !== id)
      : [...race.populations, id];
  }
}
