import { Component, computed, input, signal } from '@angular/core';

import { PopulationGraph } from '../../../core/models';
import { ResultFigureComponent } from './result-figure.component';

/** Oltre questo numero di popolazioni la sezione parte chiusa e compare il filtro. */
const COLLAPSE_ABOVE = 4;

@Component({
  selector: 'app-population-section',
  standalone: true,
  imports: [ResultFigureComponent],
  host: { class: 'block' },
  template: `
    <details class="panel" [open]="!long()">
      <summary class="cursor-pointer px-4 py-3">
        <h2 class="section-title inline">Popolazioni</h2>
        <span class="num ml-1 text-sm text-muted">({{ graphs().length }})</span>
      </summary>
      <div class="space-y-5 border-t border-line p-4">
        @if (long()) {
          <div class="max-w-xs">
            <label class="label" for="population-filter">Filtra per id della popolazione</label>
            <input
              #filter
              id="population-filter"
              type="search"
              class="input input-mono"
              autocomplete="off"
              [value]="query()"
              (input)="query.set(filter.value)"
            />
          </div>
        }
        @for (graph of filtered(); track graph.population_id) {
          <article class="space-y-2">
            <h3 class="num text-sm font-medium">{{ graph.population_id }}</h3>
            <div class="grid gap-4 lg:grid-cols-2">
              @if (graph.raster_url) {
                <app-result-figure
                  [url]="graph.raster_url"
                  [alt]="'Raster degli spike della popolazione ' + graph.population_id"
                  caption="Raster degli spike"
                />
              }
              @if (graph.histogram_url) {
                <app-result-figure
                  [url]="graph.histogram_url"
                  [alt]="'Frequenza di scarica della popolazione ' + graph.population_id"
                  caption="Frequenza di scarica"
                />
              }
            </div>
          </article>
        } @empty {
          <p class="text-sm text-muted" role="status">Nessuna popolazione corrisponde al filtro.</p>
        }
      </div>
    </details>
  `,
})
export class PopulationSectionComponent {
  readonly graphs = input.required<PopulationGraph[]>();

  protected readonly query = signal('');
  protected readonly long = computed(() => this.graphs().length > COLLAPSE_ABOVE);
  protected readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    return query ? this.graphs().filter((graph) => graph.population_id.toLowerCase().includes(query)) : this.graphs();
  });
}
