import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, switchMap, timer } from 'rxjs';

import { Campaign, EXPERIMENT_LABELS } from '../../../core/models';
import { CampaignService } from '../../../core/services/campaign.service';
import { apiErrorMessage } from '../../../core/utils/errors';
import { ConfirmButtonComponent } from '../../../shared/components/confirm-button/confirm-button.component';
import { campaignState, isActive, sweepLabel, totalOf } from '../../campaigns/campaign-helpers';

const REFRESH_MS = 5000;

/** Campagne dell'utente, una riga ciascuna. Senza campagne la sezione non compare. */
@Component({
  selector: 'app-campaign-list',
  standalone: true,
  imports: [DatePipe, RouterLink, ConfirmButtonComponent],
  host: { class: 'block' },
  template: `
    @if (error() || rows().length) {
      <section class="panel" aria-labelledby="campaigns-title">
        <div class="panel-header">
          <h2 id="campaigns-title" class="section-title">Campagne</h2>
        </div>
        @if (error()) {
          <p class="notice notice-error m-4" role="alert">{{ error() }}</p>
        }
        @if (rows().length) {
          <div class="overflow-x-auto">
            <table class="table-list">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Esperimento</th>
                  <th scope="col">Ripetizioni</th>
                  <th scope="col">Stato</th>
                  <th scope="col" class="whitespace-nowrap">Avviata il</th>
                  <th scope="col"><span class="sr-only">Azioni</span></th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.campaign.id) {
                  <tr>
                    <td class="num text-muted">{{ row.campaign.id }}</td>
                    <td class="whitespace-nowrap">
                      {{ experimentLabels[row.campaign.experiment] || row.campaign.experiment }}
                      @if (row.campaign.name && row.campaign.name !== row.campaign.network_name) {
                        <div class="max-w-[14rem] truncate text-xs text-muted" [title]="row.campaign.name">
                          {{ row.campaign.name }}
                        </div>
                      }
                    </td>
                    <!-- w-full + max-w-0: la colonna prende lo spazio che resta e tronca invece di allargare la tabella -->
                    <td class="w-full max-w-0 truncate" [title]="row.design">
                      {{ row.design }}
                    </td>
                    <td class="whitespace-nowrap">
                      <span [class]="row.state.className">{{ row.state.label }}</span>
                      <div class="num text-xs text-muted">
                        {{ row.progress }}
                      </div>
                    </td>
                    <td class="num whitespace-nowrap text-muted">
                      {{ row.campaign.created_at | date: 'dd/MM/yyyy HH:mm' }}
                    </td>
                    <td class="whitespace-nowrap text-right">
                      <div class="inline-flex items-start gap-1">
                        @if (!remove.armed()) {
                          <a class="btn btn-sm" [routerLink]="['/campaigns', row.campaign.id]">Apri</a>
                        }
                        <app-confirm-button
                          #remove
                          hint="Elimina la campagna con tutte le sue simulazioni e i risultati."
                          [disabled]="busy()"
                          (confirmed)="delete(row.campaign)"
                        />
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
})
export class CampaignListComponent {
  private campaignService = inject(CampaignService);

  protected readonly experimentLabels: Record<string, string> = EXPERIMENT_LABELS;
  protected campaigns = signal<Campaign[]>([]);
  protected error = signal<string | null>(null);
  protected busy = signal(false);

  protected rows = computed(() =>
    this.campaigns().map((campaign) => {
      const total = totalOf(campaign.counts);
      const seeds = `${campaign.seeds.length} seed`;
      const sweep = campaign.sweep ? ` × ${campaign.sweep.values.length} valori di ${sweepLabel(campaign)}` : '';
      return {
        campaign,
        design: seeds + sweep,
        state: campaignState(campaign.counts),
        progress: `${campaign.counts.COMPLETED} di ${total} completate`,
      };
    }),
  );

  private hasActive = computed(() => this.campaigns().some((campaign) => isActive(campaign.counts)));
  private request = new Subject<void>();

  constructor() {
    this.request
      .pipe(
        switchMap(() =>
          this.campaignService.getCampaigns().pipe(
            catchError((err) => {
              this.error.set(apiErrorMessage(err, 'Elenco delle campagne non caricato.'));
              this.busy.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((campaigns) => {
        this.campaigns.set(campaigns);
        this.error.set(null);
        this.busy.set(false);
      });

    // Aggiornamento automatico solo finché una campagna ha simulazioni in coda o in corso.
    toObservable(this.hasActive)
      .pipe(
        switchMap((active) => (active ? timer(REFRESH_MS, REFRESH_MS) : EMPTY)),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.request.next());

    this.request.next();
  }

  reload(): void {
    this.request.next();
  }

  protected delete(campaign: Campaign): void {
    this.busy.set(true);
    this.campaignService.deleteCampaign(campaign.id).subscribe({
      next: () => this.reload(),
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'Campagna non eliminata.'));
        this.busy.set(false);
      },
    });
  }
}
