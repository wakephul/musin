import { Component, input } from '@angular/core';

export interface Fact {
  label: string;
  value: string;
  /** Testo e non numero o identificativo: niente monospazio. */
  plain?: boolean;
}

@Component({
  selector: 'app-facts',
  standalone: true,
  host: { class: 'block' },
  template: `
    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      @for (fact of facts(); track fact.label) {
        <div>
          <dt class="label">{{ fact.label }}</dt>
          <dd [class.num]="!fact.plain">{{ fact.value }}</dd>
        </div>
      }
    </dl>
  `,
})
export class FactsComponent {
  readonly facts = input.required<Fact[]>();
}
