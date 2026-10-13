import { Component, input } from '@angular/core';

import { DECISION_MAKING_DEFAULTS } from '../../../core/data/protocol-presets';
import { ExperimentParams } from './experiment-params';
import { BUILTIN_META } from './experiment-validation';
import { ParamGroupComponent } from './param-group.component';

@Component({
  selector: 'app-decision-making-form',
  standalone: true,
  imports: [ParamGroupComponent],
  template: `
    <div class="space-y-4">
      <p class="notice">
        Questo esperimento costruisce una rete propria (rete attrattore di Wang). La rete selezionata non viene simulata.
      </p>
      <app-param-group
        [defaults]="defaults.decision_making"
        [values]="draft()['decision_making']"
        [meta]="meta"
        prefix="decision"
      />
    </div>
  `,
})
export class DecisionMakingFormComponent {
  /** Bozza con la forma di DECISION_MAKING_DEFAULTS, modificata sul posto. */
  readonly draft = input.required<ExperimentParams>();

  protected readonly defaults = DECISION_MAKING_DEFAULTS;
  protected readonly meta = BUILTIN_META.decision_making;
}
