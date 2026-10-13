import { Component, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ModelCatalogue, Population, Stimulus } from '../../../core/models';
import { DifferentialPlotsComponent } from './differential-plots.component';
import { ContinuousDraft } from './experiment-params';
import { CONTINUOUS_META, SEED, resolutionField } from './experiment-validation';
import { InputsEditorComponent } from './inputs-editor.component';
import { ParamFieldComponent } from './param-field.component';

@Component({
  selector: 'app-continuous-form',
  standalone: true,
  imports: [FormsModule, InputsEditorComponent, DifferentialPlotsComponent, ParamFieldComponent],
  host: { class: 'block space-y-5' },
  template: `
    <app-inputs-editor
      [inputs]="draft().inputs"
      [populations]="populations()"
      [catalogue]="catalogue()"
      [stimuli]="stimuli()"
      hint="In questa modalità i dispositivi restano attivi per tutta la simulazione."
    />

    <section class="panel">
      <div class="panel-header">
        <h2 class="section-title">Fasi</h2>
      </div>
      <div class="panel-body space-y-4">
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" class="checkbox" [(ngModel)]="draft().training" />
          Fase di addestramento prima del test
        </label>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          @if (draft().training) {
            <app-param-field
              fieldId="continuous-train"
              [meta]="meta.train_duration_ms"
              [(value)]="draft().train_duration_ms"
            />
          }
          <app-param-field fieldId="continuous-test" [meta]="meta.test_duration_ms" [(value)]="draft().test_duration_ms" />
        </div>
        <div>
          <label class="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" class="checkbox" [(ngModel)]="draft().disable_plasticity_during_test" />
            Blocca la plasticità durante il test
          </label>
          <p class="help">
            All'inizio del test azzera il tasso di apprendimento (<span class="num">lambda</span>) delle sinapsi STDP della
            rete.
          </p>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <app-param-field fieldId="continuous-seed" [meta]="seedMeta" [(value)]="draft().seed" />
          <app-param-field fieldId="continuous-resolution" [meta]="resolutionMeta()" [(value)]="draft().resolution" />
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2 class="section-title">Analisi</h2>
      </div>
      <div class="panel-body">
        <app-differential-plots
          [plots]="draft().differential_plots"
          [populations]="populations()"
          hint="Per ogni coppia viene tracciata la differenza di frequenza A − B nel tempo."
        />
      </div>
    </section>
  `,
})
export class ContinuousFormComponent {
  /** Bozza della simulazione continua, modificata sul posto. */
  readonly draft = input.required<ContinuousDraft>();
  readonly populations = input.required<Population[]>();
  readonly catalogue = input.required<ModelCatalogue | null | undefined>();
  readonly stimuli = input.required<Stimulus[] | null | undefined>();

  protected readonly meta = CONTINUOUS_META;
  protected readonly seedMeta = SEED;
  protected resolutionMeta = computed(() => resolutionField(this.draft().resolution));
}
