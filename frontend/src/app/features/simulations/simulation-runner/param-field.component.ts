import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FieldMeta, fieldError } from './experiment-validation';

/** Un parametro con etichetta, nota e messaggio di errore; il tipo di controllo dipende da `meta`. */
@Component({
  selector: 'app-param-field',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'block min-w-0' },
  template: `
    <label class="label" [for]="fieldId()">{{ meta().label }}</label>
    @if (meta().options; as options) {
      <select class="input" [id]="fieldId()" [ngModel]="value()" (ngModelChange)="value.set($event)">
        @for (option of options; track option.value) {
          <option [ngValue]="option.value">{{ option.label }}</option>
        }
      </select>
    } @else if (meta().text) {
      <input
        type="text"
        class="input num"
        [id]="fieldId()"
        [class.border-danger]="!!error()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="fieldId() + '-note'"
        [ngModel]="value()"
        (ngModelChange)="value.set($event)"
      />
    } @else {
      <input
        type="number"
        class="input num"
        [id]="fieldId()"
        [attr.min]="meta().min ?? null"
        [attr.max]="meta().max ?? null"
        [attr.step]="meta().integer ? 1 : 'any'"
        [class.border-danger]="!!error()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="fieldId() + '-note'"
        [ngModel]="value()"
        (ngModelChange)="value.set($event)"
      />
    }
    <div [id]="fieldId() + '-note'">
      @if (error(); as message) {
        <p class="field-error">{{ message }}</p>
      }
      @if (meta().help; as help) {
        <p class="help">{{ help }}</p>
      }
    </div>
  `,
})
export class ParamFieldComponent {
  readonly fieldId = input.required<string>();
  readonly meta = input.required<FieldMeta>();
  readonly value = model<any>(null);

  protected error = computed(() => fieldError(this.meta(), this.value()));
}
