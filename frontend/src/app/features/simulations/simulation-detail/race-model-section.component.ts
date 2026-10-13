import { Component, computed, input } from '@angular/core';

import { RaceModelGraph } from '../../../core/models';
import { ItNumPipe } from './it-num.pipe';
import { ResultFigureComponent } from './result-figure.component';
import { RaceModelStats, pairRaceModel } from './results-helpers';

const PERCENTILE_COLUMNS = [
  { key: 'A', label: 'A' },
  { key: 'V', label: 'V' },
  { key: 'AV', label: 'AV' },
  { key: 'race', label: 'Modello a gara' },
];

function percentileTable(stats: RaceModelStats | null | undefined) {
  const levels = stats?.percentile_levels;
  const values = stats?.percentiles_ms;
  if (!levels?.length || !values) return null;
  const columns = PERCENTILE_COLUMNS.filter((column) => values[column.key]?.length === levels.length);
  if (!columns.length) return null;
  return {
    columns,
    rows: levels.map((level, index) => ({ level, values: columns.map((column) => values[column.key][index]) })),
  };
}

@Component({
  selector: 'app-race-model-section',
  standalone: true,
  imports: [ItNumPipe, ResultFigureComponent],
  host: { class: 'block space-y-4' },
  template: `
    <p class="text-sm text-muted">
      Confronto tra la distribuzione cumulativa dei tempi di risposta AV e il limite del modello a gara.
    </p>
    @for (entry of entries(); track $index) {
      <article class="panel">
        <header class="panel-header">
          <h3 class="subsection-title num">{{ entry.population }}</h3>
        </header>
        <div class="panel-body grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
          @if (entry.url) {
            <app-result-figure [url]="entry.url" [alt]="'Race Model Inequality, ' + entry.population" />
          }
          @if (entry.stats; as stats) {
            <div class="space-y-3">
              @if (entry.notComputed; as reason) {
                <p>{{ reason }}</p>
              } @else if (stats.p_value === null) {
                <p>
                  Violazione massima <span class="num">{{ stats.max_rmi_violation | itNum: 2 }}</span
                  >. Test non eseguito: servono almeno 10 trial per condizione.
                </p>
              } @else {
                <p>
                  Violazione della disuguaglianza: <strong>{{ stats.has_facilitation ? 'sì' : 'no' }}</strong>
                  (massimo <span class="num">{{ stats.max_rmi_violation | itNum: 2 }}</span
                  >@if (stats.p_value !== undefined) {
                    <span class="num">, {{ pText(stats.p_value) }}</span>
                  }
                  )
                </p>
              }
              @if (stats.note) {
                <p class="help">{{ stats.note }}</p>
              }
              <div class="overflow-x-auto rounded-md border border-line">
                <table class="table-list">
                  <thead>
                    <tr>
                      <th>Condizione</th>
                      <th class="text-right">Trial con risposta</th>
                      @if (entry.hasMedians) {
                        <th class="text-right">Tempo di risposta mediano (ms)</th>
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
              @if (entry.percentiles; as table) {
                <div class="overflow-x-auto rounded-md border border-line">
                  <table class="table-list">
                    <caption class="px-4 py-2 text-left text-xs text-muted">
                      Tempi di risposta ai percentili (ms), come nella Fig. 9 di Cavadini et al. (2025).
                      @if (stats.percentiles_av_faster_than_race !== undefined) {
                        AV più veloce del modello a gara a
                        <span class="num">{{ stats.percentiles_av_faster_than_race }}</span>
                        {{ stats.percentiles_av_faster_than_race === 1 ? 'percentile' : 'percentili' }} su
                        <span class="num">{{ table.rows.length }}</span
                        >.
                      }
                    </caption>
                    <thead>
                      <tr>
                        <th>Percentile</th>
                        @for (column of table.columns; track column.key) {
                          <th class="text-right">{{ column.label }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of table.rows; track row.level) {
                        <tr>
                          <td class="num">{{ row.level }}</td>
                          @for (value of row.values; track $index) {
                            <td class="num text-right">{{ value | itNum }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              <p class="help">{{ boundText(stats) }}</p>
              @if (stats.p_value != null) {
                <p class="help">
                  p: probabilità di una violazione almeno così grande quando il modello a gara vale, stimata con
                  2000 ricampionamenti. La violazione conta se p &lt; 0,05.
                </p>
              }
              <p class="help">
                @if (stats.method === 'rate_threshold_crossing') {
                  Tempo di risposta: primo superamento della soglia da parte della frequenza di scarica, misurato
                  dall'inizio del trial.
                } @else {
                  Tempo di risposta: latenza del primo spike, misurata dall'inizio del trial.
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
  protected pText(p: number): string {
    return p < 0.001 ? 'p < 0,001' : `p = ${p.toFixed(3).replace('.', ',')}`;
  }

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
      // Con una condizione senza risposte il simulatore salta il calcolo e lascia i valori a zero:
      // scriverli come "nessuna violazione" sarebbe falso.
      const empty = counts.filter(([, count]) => count === 0).map(([condition]) => condition);
      return {
        ...entry,
        notComputed: empty.length
          ? `Disuguaglianza non calcolata: nessuna risposta ${empty.length === 1 ? 'nella condizione' : 'nelle condizioni'} ${empty.join(', ')}.`
          : null,
        hasMedians: !!medians,
        percentiles: percentileTable(entry.stats),
        rows: counts.map(([condition, count]) => ({ condition, count, median: medians?.[condition] ?? null })),
      };
    }),
  );
}
