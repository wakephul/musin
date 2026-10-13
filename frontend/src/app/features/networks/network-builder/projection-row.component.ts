import { Component, DestroyRef, OnInit, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';

import { ModelInfo } from '../../../core/models';
import { ProjectionGroup } from './network-form.controls';
import {
  CONNECTION_RULES,
  DEGREE_KEY,
  DegreeKey,
  JsonObject,
  PopulationForm,
  ProjectionProblems,
  paramsAfterModelChange,
} from './network-form.mapping';

interface DegreeField {
  label: string;
  help: string;
  min: number;
  max: number | null;
  step: string;
}

const DEGREE_FIELDS: Record<DegreeKey, DegreeField> = {
  indegree: { label: 'Indegree', help: 'Per neurone di destinazione.', min: 1, max: null, step: '1' },
  outdegree: { label: 'Outdegree', help: 'Per neurone sorgente.', min: 1, max: null, step: '1' },
  p: { label: 'p', help: 'Probabilità per coppia, fino a 1.', min: 0, max: 1, step: 'any' },
};

@Component({
  selector: 'app-projection-row',
  standalone: true,
  imports: [ReactiveFormsModule],
  host: { class: 'block' },
  template: `
    <div class="space-y-3 px-4 py-3" [formGroup]="group()">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-medium">Proiezione {{ index() + 1 }}</h3>
        <button type="button" class="btn btn-quiet btn-sm" (click)="remove.emit()">Rimuovi</button>
      </div>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1.6fr_1fr]">
        <div>
          <label class="label" [for]="uid() + '-source'">Sorgente</label>
          <select [id]="uid() + '-source'" class="input font-mono" [class.border-danger]="!!shown('source')" formControlName="source">
            <option [ngValue]="null" disabled>Scegli</option>
            @for (pop of populations(); track pop.key) {
              <option [ngValue]="pop.key">{{ pop.id || '(senza ID)' }}</option>
            }
          </select>
          @if (shown('source'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" [for]="uid() + '-target'">Destinazione</label>
          <select [id]="uid() + '-target'" class="input font-mono" [class.border-danger]="!!shown('target')" formControlName="target">
            <option [ngValue]="null" disabled>Scegli</option>
            @for (pop of populations(); track pop.key) {
              <option [ngValue]="pop.key">{{ pop.id || '(senza ID)' }}</option>
            }
          </select>
          @if (shown('target'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" [for]="uid() + '-rule'">Regola</label>
          <select [id]="uid() + '-rule'" class="input font-mono" formControlName="rule">
            @for (rule of rules; track rule) {
              <option [value]="rule">{{ rule }}</option>
            }
          </select>
        </div>
        @if (degreeField(); as field) {
          <div>
            <label class="label" [for]="uid() + '-degree'">{{ field.label }}</label>
            <input
              [id]="uid() + '-degree'"
              type="number"
              class="input num"
              [class.border-danger]="!!shown('degree')"
              formControlName="degree"
              [attr.min]="field.min"
              [attr.max]="field.max"
              [attr.step]="field.step"
            />
            @if (shown('degree'); as problem) {
              <p class="field-error" role="alert">{{ problem }}</p>
            } @else {
              <p class="help">{{ field.help }}</p>
            }
          </div>
        }

        <div class="col-span-2 md:col-start-1">
          <label class="label" [for]="uid() + '-synapse'">Modello di sinapsi</label>
          <select
            [id]="uid() + '-synapse'"
            class="input"
            [class.border-danger]="!!shown('synapse_model')"
            formControlName="synapse_model"
          >
            <option value="" disabled>Scegli</option>
            @for (id of unlisted(); track id) {
              <option [value]="id">{{ id }} (non in elenco)</option>
            }
            @for (synapse of synapses(); track synapse.id) {
              <option [value]="synapse.id">{{ synapse.id }} · {{ synapse.label }}</option>
            }
          </select>
          @if (shown('synapse_model'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" [for]="uid() + '-weight'">Peso</label>
          <input
            [id]="uid() + '-weight'"
            type="number"
            class="input num"
            [class.border-danger]="!!shown('weight')"
            formControlName="weight"
            step="any"
          />
          @if (shown('weight'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          } @else {
            <p class="help">Negativo: inibitoria.</p>
          }
        </div>
        <div>
          <label class="label" [for]="uid() + '-delay'">Ritardo (ms)</label>
          <input
            [id]="uid() + '-delay'"
            type="number"
            class="input num"
            [class.border-danger]="!!shown('delay')"
            formControlName="delay"
            step="any"
          />
          @if (shown('delay'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          }
        </div>

        <div class="col-span-2 md:col-span-4">
          <label class="label" [for]="uid() + '-extra'">Altri parametri (JSON)</label>
          <textarea
            [id]="uid() + '-extra'"
            class="input input-mono"
            [class.border-danger]="!!shown('extra')"
            formControlName="extra"
            [rows]="rows()"
            spellcheck="false"
          ></textarea>
          @if (shown('extra'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          } @else {
            <p class="help">Le altre chiavi di params: receptor_type, un peso non numerico.</p>
          }
        </div>
      </div>
    </div>
  `,
})
export class ProjectionRowComponent implements OnInit {
  readonly group = input.required<ProjectionGroup>();
  readonly index = input.required<number>();
  readonly populations = input.required<Pick<PopulationForm, 'key' | 'id'>[]>();
  readonly synapses = input.required<ModelInfo[]>();
  readonly problems = input<ProjectionProblems>();
  readonly remove = output<void>();

  protected readonly rules = CONNECTION_RULES;
  private destroyRef = inject(DestroyRef);
  /** Sinapsi con cui la riga è stata caricata: resta selezionabile anche se manca dal catalogo. */
  private storedModel = '';

  ngOnInit(): void {
    const { rule, degree, synapse_model, extra } = this.group().controls;
    this.storedModel = synapse_model.value;

    // Un indegree non ha senso come outdegree o come probabilità: cambiando regola il valore va riscritto.
    rule.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => degree.reset(null));

    let previous = synapse_model.value;
    synapse_model.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((next) => {
      extra.setValue(paramsAfterModelChange(extra.value, this.extraDefaults(previous), this.extraDefaults(next)));
      previous = next;
    });
  }

  protected uid(): string {
    return `projection-${this.index()}`;
  }

  protected degreeField(): DegreeField | null {
    const key = DEGREE_KEY[this.group().controls.rule.value];
    return key ? DEGREE_FIELDS[key] : null;
  }

  /** Il problema del campo, mostrato solo dopo che l'utente lo ha lasciato. */
  protected shown(field: keyof ProjectionProblems): string | null {
    return (this.group().controls[field].touched && this.problems()?.[field]) || null;
  }

  protected unlisted(): string[] {
    const listed = new Set(this.synapses().map((synapse) => synapse.id));
    const candidates = new Set([this.storedModel, this.group().controls.synapse_model.value]);
    return [...candidates].filter((id) => id && !listed.has(id));
  }

  protected rows(): number {
    return Math.min(12, Math.max(2, this.group().controls.extra.value.split('\n').length));
  }

  /** I default del modello senza peso e ritardo, che hanno campi propri. */
  private extraDefaults(model: string): JsonObject | undefined {
    const defaults = this.synapses().find((synapse) => synapse.id === model)?.default_params;
    return defaults && Object.fromEntries(Object.entries(defaults).filter(([key]) => key !== 'weight' && key !== 'delay'));
  }
}
