import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { NetworkService } from '../../../core/services/network.service';
import { SimulationService } from '../../../core/services/simulation.service';
import { PROTOCOL_PRESETS, ProtocolPreset } from '../../../core/data/presets';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-slate-50">
      <!-- Cinematic hero -->
      <div class="relative overflow-hidden bg-slate-900">
        <div class="aurora opacity-90"></div>
        <div class="absolute inset-0 grid-overlay opacity-30"></div>
        <div class="relative max-w-7xl mx-auto px-8 py-10">
          <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-5">
            <div>
              <p class="text-blue-300/80 text-xs font-bold uppercase tracking-widest mb-2">Control Center</p>
              <h1 class="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Dashboard</h1>
              <p class="text-slate-400 mt-2 max-w-xl">Gestisci topologie di rete e lo storico degli esperimenti NEST.</p>
            </div>
            <div class="flex flex-wrap gap-3">
              <button (click)="openRunModal()"
                class="btn-primary px-5 py-3 rounded-xl text-sm">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                Run New Simulation
              </button>
              <button routerLink="/networks/new"
                class="inline-flex items-center gap-2 font-semibold text-white bg-white/10 hover:bg-white/15 border border-white/15 px-5 py-3 rounded-xl text-sm transition-all">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Crea Nuova Rete
              </button>
            </div>
          </div>

          <!-- Stat cards -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            <div class="glass-dark rounded-2xl p-4">
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Reti</p>
              <p class="text-3xl font-black text-white mt-1">{{ networks().length }}</p>
            </div>
            <div class="glass-dark rounded-2xl p-4">
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Simulazioni</p>
              <p class="text-3xl font-black text-white mt-1">{{ simulations().length }}</p>
            </div>
            <div class="glass-dark rounded-2xl p-4">
              <p class="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Completate</p>
              <p class="text-3xl font-black text-emerald-300 mt-1">{{ countByStatus('COMPLETED') }}</p>
            </div>
            <div class="glass-dark rounded-2xl p-4">
              <p class="text-[10px] font-bold text-amber-400 uppercase tracking-widest">In corso</p>
              <p class="text-3xl font-black text-amber-300 mt-1">{{ countByStatus('RUNNING') + countByStatus('PENDING') }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="max-w-7xl mx-auto px-8 py-8">
        @if (errorMsg()) {
          <div class="mb-4 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">
            <span>{{ errorMsg() }}</span>
            <button (click)="errorMsg.set(null)" class="ml-auto text-red-400 hover:text-red-600 font-bold">✕</button>
          </div>
        }

        @if (isLoading()) {
          <div class="flex justify-center items-center py-20">
            <svg class="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        } @else {
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Networks -->
            <section class="surface-card overflow-hidden flex flex-col">
              <div class="bg-slate-800 px-5 py-4 flex justify-between items-center">
                <h2 class="text-base font-bold text-white flex items-center gap-2">
                  <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                  </svg>
                  Reti Progettate
                </h2>
                <span class="bg-slate-700 text-slate-300 text-xs font-bold px-3 py-1 rounded-full">{{ networks().length }}</span>
              </div>
              <div class="overflow-x-auto flex-1">
                <table class="w-full text-left text-sm text-slate-600">
                  <thead class="text-[10px] text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th class="px-5 py-3 font-bold">Nome Rete</th>
                      <th class="px-5 py-3 font-bold text-center">Nodi / Archi</th>
                      <th class="px-5 py-3 font-bold text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (net of networks(); track net.id) {
                      <tr class="hover:bg-blue-50/50 transition-colors">
                        <td class="px-5 py-3.5">
                          <div class="font-bold text-slate-800">{{ net.name }}</div>
                          <div class="text-xs text-slate-500 truncate max-w-[220px]">{{ net.description || 'Nessuna descrizione' }}</div>
                        </td>
                        <td class="px-5 py-3.5 text-center font-mono text-xs whitespace-nowrap">
                          <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded-md" title="Neuroni totali">{{ getNodeCount(net) | number }}</span>
                          <span class="mx-1 text-slate-300">/</span>
                          <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded-md" title="Sinapsi stimate">{{ getEdgeCount(net) | number }}</span>
                        </td>
                        <td class="px-5 py-3.5">
                          <div class="flex justify-end items-center gap-1.5 whitespace-nowrap">
                            <a [routerLink]="['/simulations/run', net.id]"
                              class="group relative inline-flex items-center justify-center w-8 h-8 rounded-lg text-blue-600 bg-blue-50 hover:text-white hover:bg-blue-600 transition-colors">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                              <span class="tooltip">Simula</span>
                            </a>
                            <a [routerLink]="['/networks', net.id]"
                              class="group relative inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 bg-slate-100 hover:text-white hover:bg-slate-600 transition-colors">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                              <span class="tooltip">Dettagli / Modifica</span>
                            </a>
                            <button (click)="openDeleteModal('network', net.id, net.name)"
                              class="group relative inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-500 bg-red-50 hover:text-white hover:bg-red-600 transition-colors">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                              <span class="tooltip">Elimina</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    } @empty {
                      <tr><td colspan="3" class="px-6 py-12 text-center text-slate-400 font-medium">
                        Nessuna rete. <a routerLink="/networks/new" class="text-blue-600 font-bold hover:underline">Creane una →</a>
                      </td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>

            <!-- Simulations -->
            <section class="surface-card overflow-hidden flex flex-col">
              <div class="bg-slate-800 px-5 py-4 flex justify-between items-center">
                <h2 class="text-base font-bold text-white flex items-center gap-2">
                  <svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                  Storico Simulazioni
                </h2>
                <button (click)="loadData()" class="text-slate-300 hover:text-white transition-colors" title="Aggiorna">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                </button>
              </div>
              <div class="overflow-x-auto flex-1">
                <table class="w-full text-left text-sm text-slate-600">
                  <thead class="text-[10px] text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th class="px-5 py-3 font-bold">Data & ID</th>
                      <th class="px-5 py-3 font-bold text-center">Stato</th>
                      <th class="px-5 py-3 font-bold text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (sim of simulations(); track sim.id) {
                      <tr class="hover:bg-emerald-50/50 transition-colors">
                        <td class="px-5 py-3.5">
                          <div class="font-bold text-slate-800">{{ sim.created_at | date: 'dd/MM/yyyy HH:mm' }}</div>
                          <div class="text-[10px] text-slate-400 font-mono">ID: {{ getShortId(sim.id) }}</div>
                        </td>
                        <td class="px-5 py-3.5 text-center">
                          <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border"
                            [ngClass]="{
                              'bg-emerald-100 text-emerald-700 border-emerald-300': isStatus(sim.status, 'COMPLETED'),
                              'bg-amber-100 text-amber-700 border-amber-300 animate-pulse': isStatus(sim.status, 'RUNNING') || isStatus(sim.status, 'PENDING'),
                              'bg-red-100 text-red-700 border-red-300': isStatus(sim.status, 'FAILED') || isStatus(sim.status, 'ABORTED')
                            }">{{ sim.status }}</span>
                        </td>
                        <td class="px-5 py-3.5">
                          <div class="flex justify-end items-center gap-1.5 whitespace-nowrap">
                            <a [routerLink]="['/simulations/detail', sim.id]"
                              class="group relative inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 bg-slate-100 hover:text-white hover:bg-slate-700 transition-colors">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                              <span class="tooltip">Dettagli</span>
                            </a>
                            <button (click)="openDeleteModal('simulation', sim.id, 'Run ' + getShortId(sim.id))"
                              class="group relative inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-400 bg-red-50 hover:text-white hover:bg-red-600 transition-colors">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                              <span class="tooltip">Elimina</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    } @empty {
                      <tr><td colspan="3" class="px-6 py-12 text-center text-slate-400 font-medium">Nessuna simulazione nello storico.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        }
      </div>
    </div>

    <!-- RUN NEW SIMULATION modal: pick a protocol + network -->
    @if (runModalOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" (click)="closeRunModal()">
        <div class="surface-card w-full max-w-2xl overflow-hidden animate-fade-rise" (click)="$event.stopPropagation()">
          <div class="bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-5 text-white">
            <h3 class="text-lg font-extrabold">Run a New Simulation</h3>
            <p class="text-blue-100 text-xs mt-1">
              @if (!selectedPreset()) {
                Opzionale: scegli un protocollo validato, poi seleziona la rete.
              } @else {
                Seleziona la rete su cui eseguire <strong>{{ selectedPreset()!.name }}</strong>.
              }
            </p>
          </div>
          <div class="max-h-[70vh] overflow-y-auto custom-scrollbar">
            <!-- Step 1: Protocol Presets -->
            <div class="p-5 border-b border-slate-100">
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">1. Protocollo (opzionale)</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                @for (preset of protocolPresets; track preset.key) {
                  <button type="button" (click)="togglePreset(preset)"
                    class="text-left rounded-lg p-3 border transition-all text-sm"
                    [class]="selectedPreset()?.key === preset.key
                      ? 'bg-blue-50 border-blue-400 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="font-bold text-slate-800 text-xs leading-tight">{{ preset.name }}</p>
                        <p class="text-[10px] text-slate-500 mt-0.5 leading-snug">{{ preset.tagline }}</p>
                        <p class="text-[9px] text-indigo-500 font-mono mt-1">Richiede: {{ preset.requiresPopulations.join(', ') }}</p>
                      </div>
                      @if (selectedPreset()?.key === preset.key) {
                        <svg class="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                        </svg>
                      }
                    </div>
                  </button>
                }
              </div>
              @if (selectedPreset()) {
                <button type="button" (click)="selectedPreset.set(null)"
                  class="mt-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors">
                  ✕ Nessun protocollo (solo rete)
                </button>
              }
            </div>
            <!-- Step 2: Networks -->
            <div class="p-5">
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">2. Rete</p>
              @if (networks().length === 0) {
                <div class="text-center py-8">
                  <p class="text-slate-500 mb-4">Non hai ancora nessuna rete.</p>
                  <a routerLink="/networks/new" (click)="closeRunModal()" class="btn-primary px-5 py-2.5 rounded-xl text-sm">Crea la prima rete</a>
                </div>
              } @else {
                <div class="space-y-2">
                  @for (net of networks(); track net.id) {
                    <button (click)="startRun(net.id)"
                      class="w-full text-left rounded-xl p-4 border transition-all group flex items-center justify-between"
                      [class]="isCompatibleNetwork(net)
                        ? 'bg-white border-slate-200 hover:border-blue-400 hover:shadow-sm'
                        : 'bg-slate-50 border-slate-200 opacity-60 hover:border-slate-300'">
                      <div class="min-w-0">
                        <p class="font-bold text-slate-800 group-hover:text-blue-700 truncate">{{ net.name }}</p>
                        <p class="text-xs text-slate-500 truncate">{{ net.description || 'Nessuna descrizione' }}</p>
                      </div>
                      <div class="ml-3 flex-shrink-0 flex items-center gap-2">
                        @if (selectedPreset() && isCompatibleNetwork(net)) {
                          <span class="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">compatibile</span>
                        }
                        <span class="text-xs font-bold text-white bg-blue-600 px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">SIMULA →</span>
                      </div>
                    </button>
                  }
                </div>
              }
            </div>
          </div>
          <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
            <button (click)="closeRunModal()" class="btn-ghost px-5 py-2.5 rounded-xl text-sm">Annulla</button>
          </div>
        </div>
      </div>
    }

    <!-- DELETE modal -->
    @if (deleteModal().isOpen) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div class="surface-card w-full max-w-md overflow-hidden animate-fade-rise">
          <div class="p-6">
            <h3 class="text-xl font-bold text-slate-900 mb-4">Conferma Eliminazione</h3>
            <p class="text-slate-600 mb-6">
              Sei sicuro di voler eliminare {{ deleteModal().type === 'network' ? 'la rete' : 'la simulazione' }}
              <strong class="text-slate-800">"{{ deleteModal().name }}"</strong>?
            </p>
            <div class="flex gap-3 justify-end">
              <button (click)="closeDeleteModal()" class="btn-ghost px-5 py-2.5 rounded-xl">Annulla</button>
              <button (click)="confirmDelete()" [disabled]="isDeleting()"
                class="px-5 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {{ isDeleting() ? 'Eliminazione...' : 'Sì, Elimina' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class DashboardComponent implements OnInit {
  private networkService = inject(NetworkService);
  private simulationService = inject(SimulationService);
  private router = inject(Router);

  isLoading = signal(true);
  networks = signal<any[]>([]);
  simulations = signal<any[]>([]);
  errorMsg = signal<string | null>(null);
  runModalOpen = signal(false);
  selectedPreset = signal<ProtocolPreset | null>(null);
  readonly protocolPresets = PROTOCOL_PRESETS;

  deleteModal = signal<{ isOpen: boolean; type: 'network' | 'simulation'; id: string; name: string }>({
    isOpen: false, type: 'network', id: '', name: '',
  });
  isDeleting = signal(false);

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.isLoading.set(true);
    forkJoin({
      nets: this.networkService.getNetworks(),
      sims: this.simulationService.getSimulations(0, 100),
    }).subscribe({
      next: (res) => {
        this.networks.set(res.nets);
        this.simulations.set([...res.sims].reverse());
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.errorMsg.set('Impossibile caricare i dati. Verifica la connessione al server.');
        this.isLoading.set(false);
      },
    });
  }

  countByStatus(target: string): number {
    return this.simulations().filter((s) => this.isStatus(s.status, target)).length;
  }

  openRunModal() { this.runModalOpen.set(true); this.selectedPreset.set(null); }
  closeRunModal() { this.runModalOpen.set(false); this.selectedPreset.set(null); }

  togglePreset(preset: ProtocolPreset) {
    this.selectedPreset.set(this.selectedPreset()?.key === preset.key ? null : preset);
  }

  isCompatibleNetwork(net: any): boolean {
    const preset = this.selectedPreset();
    if (!preset) return true;
    const popIds: string[] = (net.definition?.topology?.populations ?? []).map((p: any) => p.id);
    return preset.requiresPopulations.every(req => popIds.includes(req));
  }

  startRun(netId: string) {
    const preset = this.selectedPreset();
    this.runModalOpen.set(false);
    this.selectedPreset.set(null);
    if (preset) {
      this.router.navigate(['/simulations/run', netId], {
        state: { cloneParams: preset.payload },
      });
    } else {
      this.router.navigate(['/simulations/run', netId]);
    }
  }

  getProp(obj: any, prop: string): number {
    if (!obj) return 0;
    return obj[prop] ?? obj.definition?.[prop] ?? 0;
  }

  /** Total neurons = sum of population sizes (falls back to stored nodes_count). */
  getNodeCount(net: any): number {
    const pops = net?.definition?.topology?.populations;
    if (Array.isArray(pops) && pops.length) {
      return pops.reduce((acc: number, p: any) => acc + (Number(p.size) || 0), 0);
    }
    return this.getProp(net, 'nodes_count');
  }

  /** Estimated synapses from the projection rules (falls back to stored edges_count). */
  getEdgeCount(net: any): number {
    const topo = net?.definition?.topology;
    const pops = topo?.populations;
    const projs = topo?.projections;
    if (!Array.isArray(projs) || !projs.length) return this.getProp(net, 'edges_count');
    const size: Record<string, number> = {};
    (pops ?? []).forEach((p: any) => (size[p.id] = Number(p.size) || 0));
    return projs.reduce((acc: number, pr: any) => {
      const s = size[pr.source] ?? 0, t = size[pr.target] ?? 0;
      const indeg = Number(pr.indegree) || 0, outdeg = Number(pr.outdegree) || 0;
      switch (pr.rule) {
        case 'all_to_all':      return acc + s * t;
        case 'one_to_one':      return acc + Math.min(s, t);
        case 'fixed_indegree':  return acc + indeg * t;
        case 'fixed_outdegree': return acc + outdeg * s;
        default:                return acc + s * t;
      }
    }, 0);
  }

  getShortId(id: string): string {
    return id ? String(id).substring(0, 8) : 'N/A';
  }

  isStatus(current: string, target: string): boolean {
    if (!current) return false;
    return current.toUpperCase().trim() === target.toUpperCase();
  }

  openDeleteModal(type: 'network' | 'simulation', id: string, name: string) {
    this.deleteModal.set({ isOpen: true, type, id, name });
  }
  closeDeleteModal() {
    this.deleteModal.set({ isOpen: false, type: 'network', id: '', name: '' });
  }

  confirmDelete() {
    const modalData = this.deleteModal();
    this.isDeleting.set(true);

    const onErr = (what: string) => () => {
      this.errorMsg.set(`Errore durante l'eliminazione ${what}.`);
      this.isDeleting.set(false);
      this.closeDeleteModal();
    };

    if (modalData.type === 'network') {
      this.networkService.deleteNetwork(modalData.id).subscribe({
        next: () => {
          this.networks.update((list) => list.filter((n) => n.id !== modalData.id));
          this.isDeleting.set(false);
          this.closeDeleteModal();
        },
        error: onErr('della rete'),
      });
    } else {
      this.simulationService.deleteSimulation(modalData.id).subscribe({
        next: () => {
          this.simulations.update((list) => list.filter((s) => s.id !== modalData.id));
          this.isDeleting.set(false);
          this.closeDeleteModal();
        },
        error: onErr('della simulazione'),
      });
    }
  }
}
