import { Component, computed, input } from '@angular/core';

import { MSI_RACE_DEFAULTS, MSI_REQUIRED_POPULATIONS } from '../../../core/data/protocol-presets';
import { Population } from '../../../core/models';
import { ExperimentParams } from './experiment-params';
import { BUILTIN_META, SECTION_LABELS, missingMsiPopulations } from './experiment-validation';
import { ParamGroupComponent } from './param-group.component';

@Component({
  selector: 'app-msi-race-form',
  standalone: true,
  imports: [ParamGroupComponent],
  template: `
    <div class="space-y-6">
      <div>
        <p class="text-sm">
          Simula la rete selezionata, che deve contenere le popolazioni
          @for (id of required; track id) {
            <span [class]="missing().includes(id) ? 'tag mr-1 border-danger text-danger' : 'tag mr-1'">{{ id }}</span>
          }
        </p>
        @if (missing().length) {
          <p class="field-error" role="alert">
            Mancano nella rete: <span class="num">{{ missing().join(', ') }}</span
            >. Aggiungile nell'editor della rete prima di avviare.
          </p>
        }
      </div>

      <app-param-group [defaults]="defaults" [values]="draft()" [meta]="meta" prefix="msi" />

      <fieldset>
        <legend class="section-title">{{ sections['train'] }}</legend>
        <p class="help mb-3">
          A ogni trial lo stimolo sensoriale arriva insieme al segnale di insegnamento su IO_A e le sinapsi GR→PC_A attive
          vengono depresse.
        </p>
        <app-param-group [defaults]="defaults.train" [values]="draft()['train']" [meta]="meta" prefix="msi-train" />
      </fieldset>

      <fieldset>
        <legend class="section-title">{{ sections['test'] }}</legend>
        <p class="help mb-3">Trial V, A, AV e catch in ordine casuale, a plasticità spenta.</p>
        <app-param-group [defaults]="defaults.test" [values]="draft()['test']" [meta]="meta" prefix="msi-test" />
      </fieldset>

      <fieldset>
        <legend class="section-title">{{ sections['response'] }}</legend>
        <p class="help mb-3">
          Il tempo di reazione di un trial è il primo istante in cui la frequenza di una popolazione DCN supera la baseline
          di almeno la soglia.
        </p>
        <app-param-group
          [defaults]="defaults.test.response"
          [values]="draft()['test']['response']"
          [meta]="meta"
          prefix="msi-response"
        />
      </fieldset>
    </div>
  `,
})
export class MsiRaceFormComponent {
  /** Bozza con la forma di MSI_RACE_DEFAULTS, modificata sul posto. */
  readonly draft = input.required<ExperimentParams>();
  readonly populations = input.required<Population[]>();

  protected readonly defaults = MSI_RACE_DEFAULTS;
  protected readonly required = MSI_REQUIRED_POPULATIONS;
  protected readonly meta = BUILTIN_META.cerebellum_msi_race;
  protected readonly sections = SECTION_LABELS;
  protected missing = computed(() => missingMsiPopulations(this.populations()));
}
