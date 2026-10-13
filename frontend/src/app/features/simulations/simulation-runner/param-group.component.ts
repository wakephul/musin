import { Component, computed, input } from '@angular/core';

import { ExperimentParams } from './experiment-params';
import { FieldMeta, metaFor } from './experiment-validation';
import { ParamFieldComponent } from './param-field.component';

interface GroupField {
  id: string;
  key: string;
  /** Posizione nel valore quando il parametro è una coppia minimo/massimo. */
  index: number | null;
  meta: FieldMeta;
}

/** I parametri scalari di una sezione dei default, un campo per chiave. Le sottosezioni vanno in un gruppo a parte. */
@Component({
  selector: 'app-param-group',
  standalone: true,
  imports: [ParamFieldComponent],
  host: { class: 'grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 lg:grid-cols-4' },
  template: `
    @for (item of items(); track item.key) {
      <div [class]="item.fields.length > 1 ? 'col-span-2 grid grid-cols-2 gap-x-4' : 'contents'">
        @for (field of item.fields; track field.id) {
          <app-param-field
            [fieldId]="field.id"
            [meta]="field.meta"
            [value]="read(field)"
            (valueChange)="write(field, $event)"
          />
        }
      </div>
    }
  `,
})
export class ParamGroupComponent {
  /** Sezione dei default: decide quali campi mostrare e in che ordine. */
  readonly defaults = input.required<ExperimentParams>();
  /** La stessa sezione nella bozza, modificata sul posto. */
  readonly values = input.required<ExperimentParams>();
  readonly meta = input.required<Record<string, FieldMeta>>();
  readonly prefix = input.required<string>();

  /** Una voce per chiave; i due campi di una coppia minimo/massimo restano affiancati. */
  protected items = computed(() =>
    Object.entries(this.defaults()).flatMap(([key, sample]): { key: string; fields: GroupField[] }[] => {
      if (key === 'builtin' || (sample !== null && typeof sample === 'object' && !Array.isArray(sample))) return [];
      const meta = metaFor(this.meta(), key, sample);
      const id = `${this.prefix()}-${key}`;
      if (!Array.isArray(sample)) return [{ key, fields: [{ id, key, index: null, meta }] }];
      const fields = sample.map((_, index) => ({
        id: `${id}-${index}`,
        key,
        index,
        meta: { ...meta, label: meta.pair?.[index] ?? `${meta.label} ${index + 1}`, help: index ? undefined : meta.help },
      }));
      return [{ key, fields }];
    }),
  );

  protected read(field: GroupField): unknown {
    const value = this.values()[field.key];
    return field.index === null ? value : value?.[field.index];
  }

  protected write(field: GroupField, value: unknown): void {
    if (field.index === null) this.values()[field.key] = value;
    else this.values()[field.key][field.index] = value;
  }
}
