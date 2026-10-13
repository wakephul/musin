import { Component, computed, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';

import { SimulationResults } from '../../../core/models';
import { AccuracySectionComponent } from './accuracy-section.component';
import { ExperimentSectionComponent } from './experiment-section.component';
import { PopulationSectionComponent } from './population-section.component';
import { RaceModelSectionComponent } from './race-model-section.component';
import { ResponseSectionComponent } from './response-section.component';
import { ResultFigureComponent } from './result-figure.component';
import { buildResponseEntries } from './results-helpers';

/** I link firmati di grafici e download scadono dopo un'ora. */
const LINK_REFRESH_MS = 45 * 60 * 1000;

/** Risultati di una simulazione completata: indice, download e una sezione per tipo di analisi. */
@Component({
  selector: 'app-simulation-results',
  standalone: true,
  imports: [
    RouterLink,
    ResultFigureComponent,
    AccuracySectionComponent,
    RaceModelSectionComponent,
    ResponseSectionComponent,
    ExperimentSectionComponent,
    PopulationSectionComponent,
  ],
  host: { class: 'block space-y-5' },
  template: `
    @if (sections().length > 1 || results().graphs_zip_url || results().raw_file_url) {
      <div class="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        @if (sections().length > 1) {
          <nav class="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Sezioni dei risultati">
            @for (section of sections(); track section.id) {
              <a [routerLink]="[]" [fragment]="section.id" [replaceUrl]="true" (click)="scrollTo(section.id)">{{
                section.label
              }}</a>
            }
          </nav>
        }
        <div class="ml-auto flex flex-wrap gap-2">
          @if (results().graphs_zip_url) {
            <a class="btn btn-sm" [href]="results().graphs_zip_url" target="_blank" rel="noopener" download
              >Scarica grafici (.zip)</a
            >
          }
          @if (results().raw_file_url) {
            <a class="btn btn-sm" [href]="results().raw_file_url" target="_blank" rel="noopener" download
              >Scarica spike (.json)</a
            >
          }
        </div>
      </div>
    }

    @if (!sections().length) {
      <p class="panel empty">
        La simulazione non ha prodotto grafici né metriche: controlla i parametri e rilanciala.
      </p>
    }

    @if (shown().has('decisione')) {
      <section id="decisione" class="scroll-mt-4 space-y-3">
        <h2 class="section-title">Decisione e rilevazione</h2>
        <app-accuracy-section [metrics]="results().accuracy_metrics?.metrics ?? []" />
      </section>
    }

    @if (shown().has('race-model')) {
      <section id="race-model" class="scroll-mt-4 space-y-3">
        <h2 class="section-title">Race Model Inequality</h2>
        <app-race-model-section
          [graphs]="results().race_model_graphs"
          [results]="results().race_model_data?.race_model ?? []"
        />
      </section>
    }

    @if (shown().has('tempi-risposta')) {
      <section id="tempi-risposta" class="scroll-mt-4 space-y-3">
        <h2 class="section-title">Tempi di risposta</h2>
        <app-response-section [entries]="responseEntries()" />
      </section>
    }

    @if (shown().has('esperimento')) {
      <section id="esperimento" class="scroll-mt-4 space-y-3">
        <h2 class="section-title">Esperimento</h2>
        <app-experiment-section [graphs]="results().experiment_graphs" [metrics]="results().experiment_metrics" />
      </section>
    }

    @if (shown().has('differenziale')) {
      <section id="differenziale" class="scroll-mt-4 space-y-3">
        <h2 class="section-title">Analisi differenziale</h2>
        <div class="grid gap-4 lg:grid-cols-2">
          @for (graph of results().differential_graphs; track $index) {
            @if (graph.url) {
              <app-result-figure
                [url]="graph.url"
                [alt]="'Analisi differenziale, ' + graph.label"
                [caption]="graph.label"
              />
            }
          }
        </div>
      </section>
    }

    @if (shown().has('popolazioni')) {
      <section id="popolazioni" class="scroll-mt-4">
        <app-population-section [graphs]="results().population_graphs" />
      </section>
    }
  `,
})
export class SimulationResultsComponent {
  readonly results = input.required<SimulationResults>();
  /** Chiede a chi ha caricato i risultati di ricaricarli, prima che i link scadano con la pagina ancora aperta. */
  readonly linksExpiring = output<void>();

  protected readonly responseEntries = computed(() => {
    const results = this.results();
    return buildResponseEntries(results.response_analysis?.populations ?? [], results.response_graphs ?? []);
  });

  /** Solo le sezioni con contenuto: ogni campo dei risultati può mancare. */
  protected readonly sections = computed(() => {
    const res = this.results();
    const candidates: [id: string, label: string, present: unknown][] = [
      ['decisione', 'Decisione e rilevazione', res.accuracy_metrics?.metrics?.length],
      ['race-model', 'Race Model Inequality', res.race_model_graphs?.length || res.race_model_data?.race_model?.length],
      ['tempi-risposta', 'Tempi di risposta', this.responseEntries().length],
      ['esperimento', 'Esperimento', res.experiment_graphs?.length || Object.keys(res.experiment_metrics ?? {}).length],
      ['differenziale', 'Analisi differenziale', res.differential_graphs?.length],
      ['popolazioni', 'Popolazioni', res.population_graphs?.length],
    ];
    return candidates.filter(([, , present]) => !!present).map(([id, label]) => ({ id, label }));
  });
  protected readonly shown = computed(() => new Set(this.sections().map((section) => section.id)));

  constructor() {
    interval(LINK_REFRESH_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.linksExpiring.emit());
  }

  /** Il router aggiorna il frammento nell'URL ma non scorre la pagina: lo scorrimento è fatto qui. */
  protected scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView();
  }
}
