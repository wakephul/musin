import { Component, computed, input } from '@angular/core';

import { AccuracyMetric } from '../../../core/models';
import { Fact, FactsComponent } from './facts.component';
import { ItNumPipe } from './it-num.pipe';
import { formatNumber, winnerLabel } from './results-helpers';

interface Detection {
  hits: number;
  misses: number;
  false_alarms: number;
  correct_rejections: number;
}

type Metric = AccuracyMetric & { detection?: Detection | null };

@Component({
  selector: 'app-accuracy-section',
  standalone: true,
  imports: [FactsComponent, ItNumPipe],
  host: { class: 'block space-y-4' },
  template: `
    @for (view of views(); track $index) {
      <article class="panel">
        <header class="panel-header">
          <h3 class="font-medium">{{ view.metric.comparison }}</h3>
        </header>
        <div class="panel-body space-y-3">
          @if (view.metric.total_valid_trials > 0) {
            <p>
              Corretti <span class="num">{{ view.metric.correct_trials | itNum }}</span> su
              <span class="num">{{ view.metric.total_valid_trials | itNum }}</span> trial (<span class="num"
                >{{ view.metric.accuracy_percent | itNum: 1 }}%</span
              >).
            </p>
          } @else {
            <p class="text-muted">Nessun trial ha una risposta attesa: l'accuratezza non è calcolabile.</p>
          }
          @if (view.unevaluated > 0) {
            <p class="text-sm text-muted">
              {{ view.unevaluated === 1 ? 'Un trial non è valutato' : view.unevaluated + ' trial non sono valutati' }}
              perché senza risposta attesa.
            </p>
          }

          @if (view.detection; as detection) {
            <app-facts [facts]="detection" />
          }

          @if (view.rows.length) {
            <details>
              <summary class="cursor-pointer text-sm font-medium">Dettaglio dei trial ({{ view.rows.length }})</summary>
              <div class="mt-3 overflow-x-auto rounded-md border border-line">
                <table class="table-list">
                  <thead>
                    <tr>
                      <th class="text-right">Trial</th>
                      <th>Condizione</th>
                      <th>Stimoli attivi</th>
                      <th>Atteso</th>
                      <th>Osservato</th>
                      <th class="text-right">Evidenza netta</th>
                      <th>Esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of view.rows; track $index) {
                      <tr>
                        <td class="num text-right">{{ row.trial }}</td>
                        <td class="num">{{ row.condition }}</td>
                        <td [class.num]="row.stimuli" [class.text-muted]="!row.stimuli">{{ row.stimuli || 'nessuno' }}</td>
                        <td [class.num]="row.expected.isId" [class.text-muted]="!row.expected.isId">{{ row.expected.text }}</td>
                        <td [class.num]="row.actual.isId" [class.text-muted]="!row.actual.isId">{{ row.actual.text }}</td>
                        <td class="num text-right">{{ row.evidence | itNum: 2 : 0 }}</td>
                        <td>
                          @switch (row.correct) {
                            @case (true) {
                              <span class="text-ok">corretto</span>
                            }
                            @case (false) {
                              <span class="font-medium text-danger">errato</span>
                            }
                            @default {
                              <span class="text-muted">non valutato</span>
                            }
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="help">Evidenza netta: differenza del numero di spike tra le due popolazioni nella finestra del trial.</p>
            </details>
          }
        </div>
      </article>
    }
  `,
})
export class AccuracySectionComponent {
  readonly metrics = input.required<Metric[]>();

  protected readonly views = computed(() =>
    this.metrics().map((metric) => {
      const trials = metric.trial_details ?? [];
      return {
        metric,
        detection: metric.detection ? detectionFacts(metric.detection) : null,
        // null (o assente nei risultati più vecchi): trial senza risposta attesa, non un errore.
        unevaluated: trials.filter((trial) => trial.is_correct == null).length,
        rows: trials.map((trial) => ({
          trial: trial.trial,
          condition: trial.condition_label ?? '',
          stimuli: (trial.active_stimuli ?? []).join(', '),
          expected: winnerLabel(trial.expected_winner),
          actual: winnerLabel(trial.actual_winner),
          evidence: trial.net_evidence,
          correct: trial.is_correct ?? null,
        })),
      };
    }),
  );
}

function detectionFacts(detection: Detection): Fact[] {
  return [
    { label: 'Rilevazioni corrette (hit)', value: formatNumber(detection.hits) },
    { label: 'Mancate rilevazioni (miss)', value: formatNumber(detection.misses) },
    { label: 'Falsi allarmi', value: formatNumber(detection.false_alarms) },
    { label: 'Rifiuti corretti', value: formatNumber(detection.correct_rejections) },
  ];
}
