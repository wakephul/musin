import { AfterViewInit, Component, DestroyRef, ElementRef, NgZone, effect, inject, input, viewChild } from '@angular/core';
import cytoscape from 'cytoscape';

import { formatNumber, formatValue } from '../../../core/utils/format';

/** Ciò che il grafo legge di una popolazione. `label` sostituisce l'id come testo del nodo. */
export interface GraphPopulation {
  id: string;
  size: number;
  label?: string;
}

/** Ciò che il grafo legge di una proiezione: `source` e `target` sono id di popolazione. */
export interface GraphProjection {
  source: string;
  target: string;
  rule: string;
  params?: Record<string, unknown> | null;
}

// Colori del tema (tailwind.config.js): Cytoscape disegna su canvas e non legge le classi.
const INK = '#1c1c1a';
const MUTED = '#66665f';
const DANGER = '#b42318';
const SURFACE = '#ffffff';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Livelli dall'alto verso il basso seguendo il verso delle proiezioni: è deterministico,
// quindi aggiungere un elemento non rimescola il resto del grafo.
const LAYOUT: cytoscape.BreadthFirstLayoutOptions = {
  name: 'breadthfirst',
  directed: true,
  animate: false,
  fit: true,
  padding: 24,
  spacingFactor: 1.4,
};

function nodeData(pop: GraphPopulation) {
  const size = Number(pop.size) || 0;
  return {
    id: `n:${pop.id}`,
    label: `${(pop.label ?? pop.id) || '(senza ID)'}\n${size > 0 ? formatNumber(size) : ''}`.trim(),
    diameter: Math.round(40 + 9 * Math.log10(Math.max(size, 1))),
  };
}

function edgeLabel(rule: string, params: Record<string, unknown>): string {
  const withDegree = (prefix: string, value: unknown) =>
    typeof value === 'number' ? `${prefix} ${formatValue(value)}` : typeof value === 'string' ? `${prefix} ${value}` : prefix;
  switch (rule) {
    case 'all_to_all':
      return 'tutti';
    case 'one_to_one':
      return '1:1';
    case 'fixed_indegree':
      return withDegree('in', params['indegree']);
    case 'fixed_outdegree':
      return withDegree('out', params['outdegree']);
    case 'pairwise_bernoulli':
      return withDegree('p', params['p']);
    default:
      return rule;
  }
}

function edgeData(proj: GraphProjection, index: number) {
  const params = proj.params ?? {};
  const weight = params['weight'];
  return {
    id: `e:${index}`,
    source: `n:${proj.source}`,
    target: `n:${proj.target}`,
    label: edgeLabel(proj.rule, params),
    inhibitory: typeof weight === 'number' && weight < 0,
  };
}

@Component({
  selector: 'app-cytoscape-viewer',
  standalone: true,
  host: { class: 'block' },
  template: `
    <div class="relative">
      <div #canvas class="h-[22rem] w-full lg:h-[30rem]"></div>
      @if (!populations().length) {
        <p class="empty absolute inset-0 z-10 flex items-center justify-center">Nessuna popolazione da disegnare.</p>
      }
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted">
      <span class="inline-flex items-center gap-1.5">
        <svg class="text-ink" width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
          <path d="M0 4h19" stroke="currentColor" stroke-width="1.5" />
          <path d="M18 0l8 4-8 4z" fill="currentColor" />
        </svg>
        eccitatoria
      </span>
      <span class="inline-flex items-center gap-1.5">
        <svg class="text-danger" width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
          <path d="M0 4h25" stroke="currentColor" stroke-width="1.5" />
          <path d="M25 0v8" stroke="currentColor" stroke-width="2" />
        </svg>
        inibitoria
      </span>
      <span class="ml-auto flex items-center gap-1">
        <button type="button" class="btn btn-quiet btn-sm" (click)="zoomBy(0.8)" aria-label="Rimpicciolisci il grafo">−</button>
        <button type="button" class="btn btn-quiet btn-sm" (click)="zoomBy(1.25)" aria-label="Ingrandisci il grafo">+</button>
        <button type="button" class="btn btn-quiet btn-sm" (click)="relayout()">Riordina</button>
      </span>
    </div>
  `,
})
export class CytoscapeViewerComponent implements AfterViewInit {
  readonly populations = input.required<GraphPopulation[]>();
  readonly projections = input.required<GraphProjection[]>();

  private canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private zone = inject(NgZone);
  private cy?: cytoscape.Core;
  /** Id dei nodi ed estremi degli archi dell'ultimo disegno: il layout riparte solo se cambiano. */
  private structure = '';

  constructor() {
    effect(() => this.sync(this.populations(), this.projections()));
    inject(DestroyRef).onDestroy(() => this.cy?.destroy());
  }

  ngAfterViewInit(): void {
    // Fuori dalla zona di Angular: i movimenti del mouse sul grafo non devono far ripartire la change detection.
    this.zone.runOutsideAngular(() => {
      this.cy = cytoscape({
        container: this.canvas().nativeElement,
        maxZoom: 2.5,
        minZoom: 0.2,
        // La rotella deve continuare a scorrere la pagina anche sopra il grafo.
        userZoomingEnabled: false,
        boxSelectionEnabled: false,
        autounselectify: true,
        style: [
          {
            selector: 'node',
            style: {
              width: 'data(diameter)',
              height: 'data(diameter)',
              'background-color': SURFACE,
              'border-width': 1.5,
              'border-color': INK,
              label: 'data(label)',
              color: INK,
              'font-family': FONT,
              'font-size': 13,
              'text-wrap': 'wrap',
              'text-valign': 'center',
              'text-halign': 'center',
              'overlay-opacity': 0,
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1.5,
              'curve-style': 'bezier',
              'line-color': INK,
              'target-arrow-color': INK,
              'target-arrow-shape': 'triangle',
              label: 'data(label)',
              color: MUTED,
              'font-family': FONT,
              'font-size': 12,
              'text-background-color': SURFACE,
              'text-background-opacity': 1,
              'text-background-padding': '2px',
              'overlay-opacity': 0,
            },
          },
          {
            selector: 'edge[?inhibitory]',
            style: { 'line-color': DANGER, 'target-arrow-color': DANGER, 'target-arrow-shape': 'tee' },
          },
        ],
      });
    });
    this.sync(this.populations(), this.projections());
  }

  /** La rotella scorre la pagina: lo zoom del grafo passa dai pulsanti. */
  protected zoomBy(factor: number): void {
    const cy = this.cy;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  protected relayout(): void {
    this.zone.runOutsideAngular(() => this.cy?.layout(LAYOUT).run());
  }

  private sync(populations: GraphPopulation[], projections: GraphProjection[]): void {
    const cy = this.cy;
    if (!cy) return;

    // Cytoscape rifiuta id doppi e archi verso nodi assenti: si scartano prima.
    const ids = new Set<string>();
    const nodes = populations.filter((pop) => pop.id !== '' && !ids.has(pop.id) && ids.add(pop.id)).map(nodeData);
    const edges = projections.filter((proj) => ids.has(proj.source) && ids.has(proj.target)).map(edgeData);
    const structure = JSON.stringify([nodes.map((node) => node.id), edges.map((edge) => [edge.source, edge.target])]);

    this.zone.runOutsideAngular(() => {
      if (structure === this.structure) {
        cy.batch(() => [...nodes, ...edges].forEach((data) => cy.getElementById(data.id).data(data)));
        return;
      }
      this.structure = structure;
      cy.elements().remove();
      cy.add([
        ...nodes.map((data) => ({ group: 'nodes' as const, data })),
        ...edges.map((data) => ({ group: 'edges' as const, data })),
      ]);
      cy.layout(LAYOUT).run();
    });
  }
}
