import { Component, computed, input } from '@angular/core';

import { LabelledGraph } from '../../../core/models';
import { Fact, FactsComponent } from './facts.component';
import { ItNumPipe } from './it-num.pipe';
import { ResultFigureComponent } from './result-figure.component';
import { conditionLabel, formatNumber } from './results-helpers';

type Metrics = Record<string, any>;

interface Outcome {
  correct: number;
  wrong_side: number;
  no_response: number;
  trials: number;
}

const CONDITION_ORDER = ['auditory', 'visual', 'audiovisual'];

function conditionRank(key: string): number {
  const index = CONDITION_ORDER.indexOf(key);
  return index < 0 ? CONDITION_ORDER.length : index;
}

function responseTime(value: unknown): Pick<Fact, 'value' | 'plain'> {
  return value == null ? { value: 'nessuna risposta', plain: true } : { value: `${formatNumber(value, 1)} ms` };
}

function percent(fraction: unknown): string {
  return typeof fraction === 'number' ? `${formatNumber(fraction * 100, 1)}%` : 'n.d.';
}

@Component({
  selector: 'app-experiment-section',
  standalone: true,
  imports: [FactsComponent, ItNumPipe, ResultFigureComponent],
  host: { class: 'block space-y-4' },
  template: `
    @if (conditioning(); as view) {
      @if (view.rows.length) {
        <div class="panel overflow-x-auto">
          <table class="table-list">
            <thead>
              <tr>
                <th>Condizione</th>
                @if (view.hasOutcomes) {
                  <th class="text-right">Trial</th>
                  <th class="text-right">Corretti</th>
                  <th class="text-right">Lato sbagliato</th>
                  <th class="text-right">Nessuna risposta</th>
                } @else {
                  <th class="text-right">Accuratezza</th>
                }
                <th class="text-right">Tempo di risposta mediano (ms)</th>
              </tr>
            </thead>
            <tbody>
              @for (row of view.rows; track row.label) {
                <tr>
                  <td>{{ row.label }}</td>
                  @if (row.outcome; as outcome) {
                    <td class="num text-right">{{ outcome.trials | itNum }}</td>
                    <td class="num text-right">{{ outcome.correct | itNum }}</td>
                    <td class="num text-right">{{ outcome.wrong_side | itNum }}</td>
                    <td class="num text-right">{{ outcome.no_response | itNum }}</td>
                  } @else {
                    <td class="num text-right">{{ row.accuracy | itNum: 1 }}%</td>
                  }
                  @if (row.median === null) {
                    <td class="text-right text-muted">nessuna risposta</td>
                  } @else {
                    <td class="num text-right">{{ row.median | itNum: 1 }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @if (view.weights; as weights) {
        <div class="panel panel-body space-y-3">
          <h3 class="font-medium">Pesi sinaptici</h3>
          <app-facts [facts]="weights" />
          <p class="help">Pesi GR→PC al termine dell'addestramento. Depressa: sinapsi sotto l'80% del peso iniziale.</p>
        </div>
      }
    }

    @if (facts(); as view) {
      <div class="panel panel-body space-y-3">
        @if (view.title) {
          <h3 class="font-medium">{{ view.title }}</h3>
        }
        <app-facts [facts]="view.facts" />
      </div>
    }

    @if (json(); as text) {
      <details class="panel">
        <summary class="cursor-pointer px-4 py-3 text-sm font-medium">Metriche (JSON)</summary>
        <div class="border-t border-line p-4">
          <pre class="code-block">{{ text }}</pre>
        </div>
      </details>
    }

    @if (graphs().length) {
      <div class="grid gap-4 lg:grid-cols-2">
        @for (graph of graphs(); track $index) {
          @if (graph.url) {
            <app-result-figure [url]="graph.url" [alt]="'Esperimento, grafico ' + graph.label" [caption]="graph.label" />
          }
        }
      </div>
    }
  `,
})
export class ExperimentSectionComponent {
  readonly graphs = input.required<LabelledGraph[]>();
  readonly metrics = input.required<Metrics | null>();

  private readonly kind = computed(() => {
    const metrics = this.metrics();
    if (!metrics) return null;
    switch (metrics['experiment']) {
      case 'cerebellar_conditioning':
        return 'conditioning';
      case 'audiovisual_decision_making':
        return 'decision';
      case 'cerebellum_msi_race':
        return metrics['training'] ? 'training' : 'json';
      default:
        return 'json';
    }
  });

  protected readonly conditioning = computed(() => {
    const metrics = this.metrics();
    if (!metrics || this.kind() !== 'conditioning') return null;
    // I risultati più vecchi non hanno `outcomes`: resta solo la percentuale di accuratezza.
    const outcomes: Record<string, Outcome> | undefined = metrics['outcomes'];
    const accuracy: Record<string, number> = metrics['accuracy_pct'] ?? {};
    const medians: Record<string, number | null> = metrics['median_rt_ms'] ?? {};
    const conditions = Object.keys(outcomes ?? accuracy).sort((a, b) => conditionRank(a) - conditionRank(b));
    const weights = metrics['weight_stats'];
    return {
      hasOutcomes: !!outcomes,
      rows: conditions.map((condition) => ({
        label: conditionLabel(condition),
        outcome: outcomes?.[condition] ?? null,
        accuracy: accuracy[condition],
        median: medians[condition] ?? null,
      })),
      weights: weights
        ? ([
            { label: 'Peso medio', value: formatNumber(weights['mean'], 3) },
            { label: 'Peso minimo', value: formatNumber(weights['min'], 3) },
            { label: 'Peso massimo', value: formatNumber(weights['max'], 3) },
            { label: 'Sinapsi depresse', value: percent(weights['frac_depressed']) },
          ] satisfies Fact[])
        : null,
    };
  });

  protected readonly facts = computed<{ title: string | null; facts: Fact[] } | null>(() => {
    const metrics = this.metrics();
    if (!metrics) return null;
    if (this.kind() === 'decision') {
      const responses = metrics['response_times_ms'];
      return {
        title: null,
        facts: [
          { label: 'Modalità', value: conditionLabel(String(metrics['modality'] ?? 'n.d.')), plain: true },
          { label: 'Trial', value: formatNumber(metrics['num_trials']) },
          { label: 'Risposte', value: formatNumber(Array.isArray(responses) ? responses.length : null) },
          { label: 'Tempo di risposta mediano', ...responseTime(metrics['median_response_time_ms']) },
          { label: 'Tempo di risposta medio', ...responseTime(metrics['mean_response_time_ms']) },
          { label: 'Frequenza media A', value: `${formatNumber(metrics['avg_rate_A_hz'], 2)} Hz` },
          { label: 'Frequenza media B', value: `${formatNumber(metrics['avg_rate_B_hz'], 2)} Hz` },
          { label: 'Frequenza media inibitoria', value: `${formatNumber(metrics['avg_rate_inh_hz'], 2)} Hz` },
        ],
      };
    }
    if (this.kind() === 'training') {
      const training = metrics['training'];
      return {
        title: 'Addestramento',
        facts: [
          { label: 'Trial', value: formatNumber(training['n_trials']) },
          { label: 'Trial con fibre rampicanti (CF)', value: formatNumber(training['cf_trials']) },
          { label: 'Peso medio iniziale', value: formatNumber(training['weight_mean_before'], 3) },
          { label: 'Peso medio finale', value: formatNumber(training['weight_mean_after'], 3) },
          { label: 'Sinapsi depresse', value: percent(training['frac_depressed']) },
        ],
      };
    }
    return null;
  });

  protected readonly json = computed(() => (this.kind() === 'json' ? JSON.stringify(this.metrics(), null, 2) : null));
}
