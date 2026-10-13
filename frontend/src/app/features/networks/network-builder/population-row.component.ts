import { Component, DestroyRef, OnInit, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';

import { ModelModule } from '../../../core/models';
import { JsonObject } from '../../../core/utils/json';
import { PopulationGroup } from './network-form.controls';
import { PopulationProblems, paramsAfterModelChange } from './network-form.mapping';

@Component({
  selector: 'app-population-row',
  standalone: true,
  imports: [ReactiveFormsModule],
  host: { class: 'block' },
  template: `
    <div class="space-y-3 px-4 py-3" [formGroup]="group()">
      <div class="flex items-center justify-between gap-2">
        <h3 class="subsection-title">Popolazione {{ index() + 1 }}</h3>
        <button type="button" class="btn btn-quiet btn-sm" (click)="remove.emit()">Rimuovi</button>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.5fr)] gap-3">
        <div>
          <label class="label" [for]="uid + '-id'">ID</label>
          <input
            [id]="uid + '-id'"
            type="text"
            class="input font-mono"
            [class.border-danger]="!!shown('id')"
            formControlName="id"
            [attr.maxlength]="64"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          @if (shown('id'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" [for]="uid + '-size'">Neuroni</label>
          <input
            [id]="uid + '-size'"
            type="number"
            class="input num"
            [class.border-danger]="!!shown('size')"
            formControlName="size"
            [attr.min]="1"
            [attr.max]="1000000"
            step="1"
          />
          @if (shown('size'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" [for]="uid + '-model'">Modello</label>
          <select
            [id]="uid + '-model'"
            class="input"
            [class.border-danger]="!!shown('neuron_model')"
            formControlName="neuron_model"
          >
            <option value="" disabled>Scegli</option>
            @for (id of unlisted(); track id) {
              <option [value]="id">{{ id }} (non in elenco)</option>
            }
            @for (module of modules(); track module.id) {
              <optgroup [label]="module.label">
                @for (neuron of module.neurons; track neuron.id) {
                  <option [value]="neuron.id">{{ neuron.id }} · {{ neuron.label }}</option>
                }
              </optgroup>
            }
          </select>
          @if (shown('neuron_model'); as problem) {
            <p class="field-error" role="alert">{{ problem }}</p>
          }
        </div>
      </div>

      <div>
        <label class="label" [for]="uid + '-params'">Parametri (JSON)</label>
        <textarea
          [id]="uid + '-params'"
          class="input input-mono"
          [class.border-danger]="!!shown('params')"
          formControlName="params"
          [rows]="rows()"
          spellcheck="false"
        ></textarea>
        @if (shown('params'); as problem) {
          <p class="field-error" role="alert">{{ problem }}</p>
        }
      </div>
    </div>
  `,
})
export class PopulationRowComponent implements OnInit {
  readonly group = input.required<PopulationGroup>();
  readonly index = input.required<number>();
  readonly modules = input.required<ModelModule[]>();
  readonly problems = input<PopulationProblems>();
  readonly remove = output<void>();

  private destroyRef = inject(DestroyRef);
  /** Modello con cui la riga è stata caricata: resta selezionabile anche se manca dal catalogo. */
  private storedModel = '';

  protected get uid(): string {
    return `population-${this.group().controls.key.value}`;
  }

  ngOnInit(): void {
    const { neuron_model, params } = this.group().controls;
    this.storedModel = neuron_model.value;
    let previous = neuron_model.value;
    neuron_model.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((next) => {
      params.setValue(paramsAfterModelChange(params.value, this.defaultsOf(previous), this.defaultsOf(next)));
      previous = next;
    });
  }

  /** Il problema del campo, mostrato solo dopo che l'utente lo ha lasciato. */
  protected shown(field: keyof PopulationProblems): string | null {
    return (this.group().controls[field].touched && this.problems()?.[field]) || null;
  }

  protected unlisted(): string[] {
    const listed = new Set(this.modules().flatMap((module) => module.neurons.map((neuron) => neuron.id)));
    const candidates = new Set([this.storedModel, this.group().controls.neuron_model.value]);
    return [...candidates].filter((id) => id && !listed.has(id));
  }

  protected rows(): number {
    return Math.min(12, Math.max(2, this.group().controls.params.value.split('\n').length));
  }

  private defaultsOf(model: string): JsonObject | undefined {
    return this.modules()
      .flatMap((module) => module.neurons)
      .find((neuron) => neuron.id === model)?.default_params;
  }
}
