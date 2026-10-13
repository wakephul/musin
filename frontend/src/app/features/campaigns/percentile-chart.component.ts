import { Component, computed, input } from '@angular/core';

import { ChartSeries } from './campaign-helpers';

const WIDTH = 640;
const HEIGHT = 300;
const MARGIN = { left: 46, right: 14, top: 12, bottom: 38 };

/** Stile per condizione, lo stesso dei grafici del simulatore: uditivo e visivo tratteggiati, AV pieno. */
const STYLE: Record<string, { color: string; dash: string; marker: 'square' | 'circle' | 'diamond' }> = {
  A: { color: '#1c1c1a', dash: '5 3', marker: 'square' },
  V: { color: '#1c1c1a', dash: '5 3', marker: 'circle' },
  AV: { color: '#0f6e6e', dash: '', marker: 'diamond' },
  race: { color: '#9a9a92', dash: '', marker: 'circle' },
};
const FALLBACK = { color: '#66665f', dash: '', marker: 'circle' as const };

function markerPath(shape: 'square' | 'circle' | 'diamond', x: number, y: number): string {
  const r = 3.2;
  if (shape === 'square') return `M${x - r},${y - r}h${2 * r}v${2 * r}h${-2 * r}z`;
  if (shape === 'diamond') return `M${x},${y - r - 1}l${r + 1},${r + 1}l${-r - 1},${r + 1}l${-r - 1},${-r - 1}z`;
  return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
}

/**
 * Tempi di risposta ai percentili, una curva per condizione (come la Fig. 9 di Cavadini et al. 2025).
 * Le curve del riferimento sono punteggiate e più chiare, con i segni vuoti.
 */
@Component({
  selector: 'app-percentile-chart',
  standalone: true,
  host: { class: 'block' },
  template: `
    @if (plot(); as p) {
      <svg class="figure" [attr.viewBox]="viewBox" role="img" [attr.aria-label]="label()">
        @for (tick of p.yTicks; track tick.value) {
          <line [attr.x1]="left" [attr.x2]="right" [attr.y1]="tick.y" [attr.y2]="tick.y" stroke="#e2e2dd" stroke-width="1" />
          <text [attr.x]="left - 6" [attr.y]="tick.y + 3" text-anchor="end" font-size="10" fill="#66665f">
            {{ tick.value }}
          </text>
        }
        @for (tick of p.xTicks; track tick.value) {
          <line
            [attr.x1]="tick.x"
            [attr.x2]="tick.x"
            [attr.y1]="bottom"
            [attr.y2]="bottom + 4"
            stroke="#9a9a92"
            stroke-width="1"
          />
          <text [attr.x]="tick.x" [attr.y]="bottom + 15" text-anchor="middle" font-size="10" fill="#66665f">
            {{ tick.value }}
          </text>
        }
        <line [attr.x1]="left" [attr.x2]="right" [attr.y1]="bottom" [attr.y2]="bottom" stroke="#9a9a92" stroke-width="1" />
        <text [attr.x]="(left + right) / 2" [attr.y]="height - 4" text-anchor="middle" font-size="11" fill="#66665f">
          Tempo di risposta (ms)
        </text>
        <text
          [attr.transform]="'translate(12 ' + (top + bottom) / 2 + ') rotate(-90)'"
          text-anchor="middle"
          font-size="11"
          fill="#66665f"
        >
          Percentile
        </text>
        @for (line of p.lines; track line.label) {
          <g [attr.opacity]="line.reference ? 0.6 : 1">
            <path
              [attr.d]="line.path"
              fill="none"
              [attr.stroke]="line.color"
              [attr.stroke-width]="line.reference ? 1.2 : 1.8"
              [attr.stroke-dasharray]="line.dash"
            />
            <path
              [attr.d]="line.markers"
              [attr.fill]="line.reference ? '#ffffff' : line.color"
              [attr.stroke]="line.color"
              stroke-width="1.2"
            />
          </g>
        }
      </svg>
      <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        @for (line of p.lines; track line.label) {
          <li class="inline-flex items-center gap-1.5">
            <svg width="26" height="10" aria-hidden="true" [attr.opacity]="line.reference ? 0.6 : 1">
              <line
                x1="0"
                x2="26"
                y1="5"
                y2="5"
                [attr.stroke]="line.color"
                stroke-width="1.6"
                [attr.stroke-dasharray]="line.dash"
              />
              <path
                [attr.d]="line.legendMarker"
                [attr.fill]="line.reference ? '#ffffff' : line.color"
                [attr.stroke]="line.color"
                stroke-width="1.2"
              />
            </svg>
            {{ line.label }}
          </li>
        }
      </ul>
    }
  `,
})
export class PercentileChartComponent {
  readonly levels = input.required<number[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly label = input('Tempi di risposta ai percentili');

  protected readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
  protected readonly height = HEIGHT;
  protected readonly left = MARGIN.left;
  protected readonly right = WIDTH - MARGIN.right;
  protected readonly top = MARGIN.top;
  protected readonly bottom = HEIGHT - MARGIN.bottom;

  protected readonly plot = computed(() => {
    const series = this.series();
    const levels = this.levels();
    const all = series.flatMap((entry) => entry.values);
    if (!all.length || !levels.length) return null;

    // Asse x su multipli di 50 ms, con al massimo una decina di tacche.
    const low = Math.floor(Math.min(...all) / 50) * 50;
    const high = Math.max(Math.ceil(Math.max(...all) / 50) * 50, low + 50);
    const step = [50, 100, 200, 500, 1000].find((size) => (high - low) / size <= 10) ?? 2000;
    const x = (value: number) => this.left + ((value - low) / (high - low)) * (this.right - this.left);
    const y = (level: number) => this.bottom - (level / 100) * (this.bottom - this.top);

    const xTicks = [];
    for (let value = Math.ceil(low / step) * step; value <= high; value += step) xTicks.push({ value, x: x(value) });

    return {
      xTicks,
      yTicks: levels.map((level) => ({ value: level, y: y(level) })),
      lines: series.map((entry) => {
        const style = STYLE[entry.condition] ?? FALLBACK;
        const points = entry.values.map((value, index) => [x(value), y(levels[index])] as const);
        return {
          label: entry.label,
          reference: entry.reference,
          color: style.color,
          dash: entry.reference ? '1.5 3' : style.dash,
          path: points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(''),
          markers: points.map(([px, py]) => markerPath(style.marker, +px.toFixed(1), +py.toFixed(1))).join(''),
          legendMarker: markerPath(style.marker, 13, 5),
        };
      }),
    };
  });
}
