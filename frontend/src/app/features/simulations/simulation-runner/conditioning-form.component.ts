import { Component, input } from '@angular/core';

import { CONDITIONING_DEFAULTS } from '../../../core/data/protocol-presets';
import { CONDITIONING_TRIAL_MS, ExperimentParams } from './experiment-params';
import { BUILTIN_META } from './experiment-validation';
import { ParamGroupComponent } from './param-group.component';

@Component({
  selector: 'app-conditioning-form',
  standalone: true,
  imports: [ParamGroupComponent],
  template: `
    <div class="space-y-4">
      <p class="notice">
        Questo esperimento costruisce una rete propria (2000 GR, 100 PC, 50 DCN, modello
        <span class="num">iaf_cond_exp</span>). La rete selezionata non viene simulata.
      </p>
      <app-param-group [defaults]="defaults" [values]="draft()" [meta]="meta" prefix="conditioning" />
      <p class="help">Ogni trial dura {{ trialSeconds }} s di tempo biologico.</p>
    </div>
  `,
})
export class ConditioningFormComponent {
  /** Bozza con la forma di CONDITIONING_DEFAULTS, modificata sul posto. */
  readonly draft = input.required<ExperimentParams>();

  protected readonly defaults = CONDITIONING_DEFAULTS;
  protected readonly meta = BUILTIN_META.cerebellum_conditioning;
  protected readonly trialSeconds = CONDITIONING_TRIAL_MS / 1000;
}
