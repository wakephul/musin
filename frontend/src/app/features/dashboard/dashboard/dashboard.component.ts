import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Network } from '../../../core/models';
import { NetworkService } from '../../../core/services/network.service';
import { apiErrorMessage } from '../../../core/utils/errors';
import { countNeurons, countSynapses } from '../../../core/utils/topology';
import { ConfirmButtonComponent } from '../../../shared/components/confirm-button/confirm-button.component';
import { SimulationListComponent } from './simulation-list.component';

const INTEGER = new Intl.NumberFormat('it-IT');

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe, RouterLink, ConfirmButtonComponent, SimulationListComponent],
  template: `
    <div class="page space-y-6">
      <h1 class="page-title">Panoramica</h1>

      <section class="panel" aria-labelledby="networks-title">
        <div class="panel-header">
          <h2 id="networks-title" class="section-title">Reti</h2>
          <a routerLink="/networks/new" class="btn btn-primary">Nuova rete</a>
        </div>
        @if (error()) {
          <p class="notice notice-error m-4" role="alert">{{ error() }}</p>
        }
        @if (networks()) {
          @if (rows().length) {
            <div class="overflow-x-auto">
              <table class="table-list">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col" class="!text-right">Popolazioni</th>
                    <th scope="col" class="!text-right">Neuroni</th>
                    <th scope="col" class="!text-right">Sinapsi</th>
                    <th scope="col" class="hidden whitespace-nowrap lg:table-cell">Modificata il</th>
                    <th scope="col"><span class="sr-only">Azioni</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.network.id) {
                    <tr>
                      <!-- w-full + max-w-0: la colonna prende lo spazio che resta e tronca invece di allargare la tabella -->
                      <td class="w-full max-w-0">
                        <div class="font-medium">{{ row.network.name }}</div>
                        @if (row.network.description) {
                          <div class="truncate text-xs text-muted" [title]="row.network.description">
                            {{ row.network.description }}
                          </div>
                        }
                      </td>
                      <td class="num text-right">{{ row.populations }}</td>
                      <td class="num text-right">{{ row.neurons }}</td>
                      <td class="num text-right">{{ row.synapses }}</td>
                      <td class="num hidden whitespace-nowrap text-muted lg:table-cell">
                        {{ row.network.updated_at | date: 'dd/MM/yyyy HH:mm' }}
                      </td>
                      <td class="whitespace-nowrap text-right">
                        <div class="inline-flex items-start gap-1">
                          @if (!remove.armed()) {
                            <a class="btn btn-sm" [routerLink]="['/simulations/run', row.network.id]">Simula</a>
                            <a class="btn btn-quiet btn-sm" [routerLink]="['/networks', row.network.id]">Modifica</a>
                            <button
                              type="button"
                              class="btn btn-quiet btn-sm"
                              [disabled]="busyId() === row.network.id"
                              (click)="duplicate(row.network)"
                            >
                              Duplica
                            </button>
                          }
                          <app-confirm-button
                            #remove
                            hint="Elimina anche le simulazioni e i risultati di questa rete."
                            [disabled]="busyId() === row.network.id"
                            (confirmed)="delete(row.network)"
                          />
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="empty">Non hai ancora reti: <a routerLink="/networks/new">crea la prima</a>.</p>
          }
        } @else if (!error()) {
          <p class="empty">Caricamento…</p>
        }
      </section>

      <app-simulation-list />
    </div>
  `,
})
export class DashboardComponent {
  private networkService = inject(NetworkService);
  private simulationList = viewChild.required(SimulationListComponent);

  /** `null` finché il primo caricamento non è arrivato. */
  protected networks = signal<Network[] | null>(null);
  protected error = signal<string | null>(null);
  protected busyId = signal<number | null>(null);
  protected rows = computed(() =>
    (this.networks() ?? []).map((network) => {
      const topology = network.definition?.topology;
      return {
        network,
        populations: topology?.populations?.length ?? 0,
        neurons: INTEGER.format(countNeurons(topology?.populations)),
        synapses: INTEGER.format(countSynapses(topology?.populations, topology?.projections)),
      };
    }),
  );

  constructor() {
    this.load();
  }

  protected duplicate(network: Network): void {
    this.busyId.set(network.id);
    this.networkService.forkNetwork(network.id).subscribe({
      next: () => this.load(),
      error: (err) => this.fail(err, 'Rete non duplicata.'),
    });
  }

  protected delete(network: Network): void {
    this.busyId.set(network.id);
    this.networkService.deleteNetwork(network.id).subscribe({
      next: () => {
        this.load();
        // Con la rete il server elimina anche le sue simulazioni.
        this.simulationList().reload();
      },
      error: (err) => this.fail(err, 'Rete non eliminata.'),
    });
  }

  private load(): void {
    this.networkService.getNetworks().subscribe({
      next: (networks) => {
        this.networks.set(networks);
        this.error.set(null);
        this.busyId.set(null);
      },
      error: (err) => this.fail(err, 'Elenco delle reti non caricato.'),
    });
  }

  private fail(err: unknown, fallback: string): void {
    this.error.set(apiErrorMessage(err, fallback));
    this.busyId.set(null);
  }
}
