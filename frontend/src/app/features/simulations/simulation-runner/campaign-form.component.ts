import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CUSTOM_PATH, CampaignDraft, MAX_CAMPAIGN_SIMULATIONS } from './campaign-draft';

/** Ripetizioni e parametro variabile: con più di un seed o un parametro scelto il lancio diventa una campagna. */
@Component({
  selector: 'app-campaign-form',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'block' },
  template: `
    <div class="grid gap-x-6 gap-y-4 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <label class="label" for="campaign-repeats">Ripetizioni</label>
        <input id="campaign-repeats" type="number" class="input num" min="1" [max]="max" step="1" [(ngModel)]="draft().repeats" />
      </div>
      <div>
        <label class="label" for="campaign-sweep">Parametro da variare</label>
        <select id="campaign-sweep" class="input" [(ngModel)]="draft().sweepPath">
          <option value="">Nessuno</option>
          @for (option of options(); track option.path) {
            <option [value]="option.path">{{ option.label }}</option>
          }
          <option [value]="customPath">Altro parametro…</option>
        </select>
      </div>
      @if (draft().sweepPath) {
        <div>
          <label class="label" for="campaign-values">Valori</label>
          <input
            id="campaign-values"
            type="text"
            class="input num"
            placeholder="150 165 180"
            autocomplete="off"
            [(ngModel)]="draft().valuesText"
          />
          <p class="help">Separati da spazi. Ogni valore viene simulato con tutte le ripetizioni.</p>
        </div>
      }
    </div>
    <p class="help">
      Con più di una ripetizione la simulazione si ripete con seed consecutivi, a partire da quello indicato sopra, e i tempi di
      risposta vengono messi insieme.
    </p>
    @if (draft().sweepPath === customPath) {
      <div class="mt-4 max-w-md">
        <label class="label" for="campaign-path">Percorso del parametro</label>
        <input
          id="campaign-path"
          type="text"
          class="input input-mono"
          placeholder="network_overrides.eta_ex"
          autocomplete="off"
          spellcheck="false"
          [(ngModel)]="draft().customPath"
        />
        <p class="help">Il nome che il parametro ha nei parametri di lancio, con le sezioni separate da un punto.</p>
      </div>
    }
    @if (campaign()) {
      <label class="mt-4 inline-flex items-center gap-2 text-sm">
        <input type="checkbox" class="checkbox" [(ngModel)]="draft().saveSpikes" />
        Salva gli spike di ogni simulazione
      </label>
      <p class="help">
        Senza, restano grafici e tempi di risposta. Gli spike di una rete grande pesano centinaia di MB a simulazione.
      </p>
    }
  `,
})
export class CampaignFormComponent {
  /** Bozza modificata sul posto, come quelle degli altri moduli. */
  readonly draft = input.required<CampaignDraft>();
  readonly options = input.required<{ path: string; label: string }[]>();
  readonly campaign = input.required<boolean>();

  protected readonly max = MAX_CAMPAIGN_SIMULATIONS;
  protected readonly customPath = CUSTOM_PATH;
}
