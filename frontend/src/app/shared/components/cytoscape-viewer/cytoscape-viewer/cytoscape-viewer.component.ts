import {
  Component,
  ElementRef,
  Input,
  ViewChild,
  AfterViewInit,
  OnChanges,
  SimpleChanges,
  inject,
  NgZone,
} from '@angular/core';
import cytoscape from 'cytoscape';

@Component({
  selector: 'app-cytoscape-viewer',
  standalone: true,
  template: `
    <div
      class="relative w-full h-full bg-slate-50 rounded-xl overflow-hidden shadow-inner"
    >
      <div #cyCanvas class="w-full h-full min-h-[400px]"></div>
      <div class="absolute bottom-4 right-4 flex gap-2 z-10">
        <button
          (click)="resetLayout()"
          class="bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 shadow-sm transition-colors"
        >
          Ribilancia Grafo
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class CytoscapeViewerComponent implements AfterViewInit, OnChanges {
  @ViewChild('cyCanvas') cyCanvas!: ElementRef;
  @Input({ required: true }) elements: any[] = [];

  private cy?: cytoscape.Core;
  private zone = inject(NgZone);

  private layoutConfig = {
    name: 'cose',
    animate: true,
    padding: 60,
    nodeRepulsion: () => 600000, // Massima repulsione
    idealEdgeLength: () => 200, // Spazio vitale per le etichette degli archi
    edgeElasticity: () => 100,
    gravity: 0.15, // Gravità bassa per far espandere il grafo
  };

  ngAfterViewInit() {
    this.initCytoscape();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['elements'] && this.cy) {
      this.cy.json({ elements: this.elements });
      this.resetLayout();
    }
  }

  private initCytoscape() {
    this.zone.runOutsideAngular(() => {
      this.cy = cytoscape({
        container: this.cyCanvas.nativeElement,
        elements: this.elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#3b82f6',
              label: 'data(label)',
              color: '#1e293b',
              'font-size': '9px',
              'font-weight': 'bold',
              'text-wrap': 'wrap',
              'text-valign': 'bottom',
              'text-margin-y': 6,
              // Mappatura dinamica ESPLICITA: da 1 neurone a 5000 neuroni -> da 30px a 120px
              width: 'mapData(size, 1, 5000, 30, 120)',
              height: 'mapData(size, 1, 5000, 30, 120)',
              'border-width': 2,
              'border-color': '#2563eb',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1.5,
              'line-color': '#94a3b8',
              'target-arrow-color': '#94a3b8',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              label: 'data(label)',
              'font-size': '7px',
              color: '#334155',
              'text-rotation': 'autorotate',
              'text-background-color': '#ffffff',
              'text-background-opacity': 0.9,
              'text-background-padding': '3px',
              'text-background-shape': 'roundrectangle',
              'text-wrap': 'wrap',
              'text-margin-y': -10,
            },
          },
        ],
        layout: this.layoutConfig,
      });
    });
  }

  resetLayout() {
    this.cy?.layout(this.layoutConfig).run();
  }
}
