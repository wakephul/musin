import { Component, computed, input, signal } from '@angular/core';

/**
 * Grafico prodotto dal simulatore. L'URL è firmato e scade dopo un'ora:
 * se l'immagine non si carica resta un testo al posto dell'icona rotta.
 */
@Component({
  selector: 'app-result-figure',
  standalone: true,
  host: { class: 'block' },
  template: `
    <figure>
      @if (failed()) {
        <p class="text-xs text-muted">Immagine non disponibile, ricarica la pagina.</p>
      } @else {
        <a [href]="url()" target="_blank" rel="noopener" title="Apri a dimensione piena in una nuova scheda" class="block">
          <img class="figure" [src]="url()" [alt]="alt()" loading="lazy" (error)="failedUrl.set(url())" />
        </a>
      }
      @if (caption()) {
        <figcaption class="help">{{ caption() }}</figcaption>
      }
    </figure>
  `,
})
export class ResultFigureComponent {
  readonly url = input.required<string>();
  readonly alt = input.required<string>();
  readonly caption = input<string>();

  /** L'errore vale per l'URL che l'ha dato: con un link rinnovato l'immagine si riprova. */
  protected failedUrl = signal<string | null>(null);
  protected failed = computed(() => this.failedUrl() === this.url());
}
