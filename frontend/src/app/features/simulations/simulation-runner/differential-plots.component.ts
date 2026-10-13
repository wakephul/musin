import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Population } from '../../../core/models';
import { DifferentialPlot } from './experiment-params';

/** Coppie di popolazioni da confrontare (A − B). */
@Component({
  selector: 'app-differential-plots',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'block' },
  template: `
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold">Coppie differenziali</h3>
        <p class="help">{{ hint() }}</p>
      </div>
      <button type="button" class="btn btn-sm" [disabled]="populations().length < 2" (click)="add()">Aggiungi coppia</button>
    </div>
    @for (plot of plots(); track plot; let i = $index) {
      <div class="mt-3 flex flex-wrap items-start gap-3">
        <div class="w-40">
          <label class="label" [for]="'pair-' + i + '-a'">Popolazione A</label>
          <select class="input num" [id]="'pair-' + i + '-a'" [(ngModel)]="plot.pop_a">
            <option value="" disabled>Scegli</option>
            @for (population of populations(); track population.id) {
              <option [value]="population.id">{{ population.id }}</option>
            }
          </select>
        </div>
        <div class="w-40">
          <label class="label" [for]="'pair-' + i + '-b'">Popolazione B</label>
          <select class="input num" [id]="'pair-' + i + '-b'" [(ngModel)]="plot.pop_b">
            <option value="" disabled>Scegli</option>
            @for (population of populations(); track population.id) {
              <option [value]="population.id">{{ population.id }}</option>
            }
          </select>
        </div>
        <div class="w-64">
          <label class="label" [for]="'pair-' + i + '-label'">Etichetta (facoltativa)</label>
          <input
            type="text"
            class="input"
            [id]="'pair-' + i + '-label'"
            [(ngModel)]="plot.label"
            [placeholder]="plot.pop_a && plot.pop_b ? plot.pop_a + ' − ' + plot.pop_b : ''"
          />
        </div>
        <button type="button" class="btn btn-quiet btn-sm mt-5" (click)="remove(plot)">Rimuovi</button>
      </div>
    }
  `,
})
export class DifferentialPlotsComponent {
  /** Elenco della bozza, modificato sul posto. */
  readonly plots = input.required<DifferentialPlot[]>();
  readonly populations = input.required<Population[]>();
  readonly hint = input.required<string>();

  protected add(): void {
    this.plots().push({ pop_a: '', pop_b: '', label: '' });
  }

  protected remove(plot: DifferentialPlot): void {
    this.plots().splice(this.plots().indexOf(plot), 1);
  }
}
