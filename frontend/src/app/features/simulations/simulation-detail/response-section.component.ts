import { Component, input } from '@angular/core';

import { ResponseGraph } from '../../../core/models';
import { ItNumPipe } from './it-num.pipe';
import { ResultFigureComponent } from './result-figure.component';
import { ResponseEntry } from './results-helpers';

const KIND_LABELS: Record<ResponseGraph['kind'], string> = {
  activation: 'Attivazione delle popolazioni',
  cdf: 'Distribuzione cumulativa dei tempi di risposta',
};

@Component({
  selector: 'app-response-section',
  standalone: true,
  imports: [ItNumPipe, ResultFigureComponent],
  host: { class: 'block space-y-4' },
  template: `
    @for (entry of entries(); track $index) {
      <article class="panel">
        <header class="panel-header">
          <h3 class="font-medium">{{ entry.label }}</h3>
        </header>
        <div class="panel-body space-y-4">
          @if (entry.rows.length) {
            <div class="max-w-md overflow-x-auto rounded-md border border-line">
              <table class="table-list">
                <thead>
                  <tr>
                    <th>Condizione</th>
                    <th class="text-right">Trial con risposta</th>
                    <th class="text-right">Mediana (ms)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of entry.rows; track row.condition) {
                    <tr>
                      <td class="num">{{ row.condition }}</td>
                      <td class="num text-right">{{ row.count | itNum }}</td>
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
          @if (entry.graphs.length) {
            <div class="grid gap-4 lg:grid-cols-2">
              @for (graph of entry.graphs; track $index) {
                @if (graph.url) {
                  <app-result-figure
                    [url]="graph.url"
                    [alt]="kindLabels[graph.kind] + ', ' + entry.label"
                    [caption]="kindLabels[graph.kind]"
                  />
                }
              }
            </div>
          }
        </div>
      </article>
    }
  `,
})
export class ResponseSectionComponent {
  readonly entries = input.required<ResponseEntry[]>();

  protected readonly kindLabels = KIND_LABELS;
}
