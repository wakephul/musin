import { Component, computed, input } from '@angular/core';

import { RaceModelGraph } from '../../../core/models';
import { ItNumPipe } from './it-num.pipe';
import { ResultFigureComponent } from './result-figure.component';
import { RaceModelStats, pairRaceModel } from './results-helpers';

@Component({
  selector: 'app-race-model-section',
  standalone: true,
  imports: [ItNumPipe, ResultFigureComponent],
  host: { class: 'block space-y-4' },
  template: `
    <p class="text-sm text-muted">
      Confronto tra la distribuzione cumulativa dei tempi di reazione AV e il limite del modello a gara.
    </p>
    @for (entry of entries(); track $index) {
      <article class="panel">
        <header class="panel-header">
          <h3 class="num font-medium">{{ entry.population }}</h3>
        </header>
        <div class="panel-body grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
          @if (entry.url) {
            <app-result-figure [url]="entry.url" [alt]="'Race Model Inequality, ' + entry.population" />
          }
          @if (entry.stats; as stats) {
            <div class="space-y-3">
              <p>
                Violazione della disuguaglianza: <strong>{{ stats.has_facilitation ? 'sì' : 'no' }}</strong>
                (massimo <span class="num">{{ stats.max_rmi_violation | itNum: 2 }}</span
                >)
              </p>
              <div class="overflow-x-auto rounded-md border border-line">
                <table class="table-list">
                  <thead>
                    <tr>
                      <th>Condizione</th>
                      <th class="text-right">Trial con risposta</th>
                      @if (entry.hasMedians) {
                        <th class="text-right">Tempo di reazione mediano (ms)</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of entry.rows; track row.condition) {
                      <tr>
                        <td class="num">{{ row.condition }}</td>
                        <td class="num text-right">{{ row.count | itNum }}</td>
                        @if (entry.hasMedians) {
                          @if (row.median === null) {
                            <td class="text-right text-muted">nessuna risposta</td>
                          } @else {
                            <td class="num text-right">{{ row.median | itNum: 1 }}</td>
                          }
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="help">{{ boundText(stats) }}</p>
              <p class="help">
                @if (stats.method === 'rate_threshold_crossing') {
                  Tempo di reazione: primo superamento della soglia di frequenza di scarica dopo lo stimolo.
                } @else {
                  Tempo di reazione: latenza del primo spike dopo lo stimolo.
                }
              </p>
            </div>
          } @else {
            <p class="text-sm text-muted">Statistiche non registrate per questo grafico.</p>
          }
        </div>
      </article>
    }
  `,
})
export class RaceModelSectionComponent {
  /** Il limite usato è cambiato nel tempo: i risultati salvati dicono con quale sono stati calcolati. */
  protected boundText(stats: RaceModelStats): string {
    if (stats.trials) return 'Limite di Miller, min(1, F_V + F_A), con le distribuzioni calcolate su tutti i trial.';
    if (stats.method === 'rate_threshold_crossing') {
      return 'Limite di Miller, min(1, F_V + F_A), con le distribuzioni calcolate sui soli trial con risposta.';
    }
    return 'Limite del modello a gara indipendente, F_V + F_A − F_V·F_A, sui soli trial con risposta.';
  }

  readonly graphs = input.required<RaceModelGraph[]>();
  readonly results = input.required<RaceModelStats[]>();

  protected readonly entries = computed(() =>
    pairRaceModel(this.graphs(), this.results()).map((entry) => {
      const medians = entry.stats?.median_rt_ms;
      const counts: [string, number | undefined][] = [
        ['V', entry.stats?.n_V],
        ['A', entry.stats?.n_A],
        ['AV', entry.stats?.n_AV],
      ];
      return {
        ...entry,
        hasMedians: !!medians,
        rows: counts.map(([condition, count]) => ({ condition, count, median: medians?.[condition] ?? null })),
      };
    }),
  );
}
