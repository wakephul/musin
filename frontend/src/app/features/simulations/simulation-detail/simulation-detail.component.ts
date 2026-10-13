import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  SimulationService,
  SimulationStatus,
  SimulationResult,
  RaceModelResult,
} from '../../../core/services/simulation.service';
import { NetworkService } from '../../../core/services/network.service';
import { countNeurons, countSynapses } from '../../../core/utils/topology';

@Component({
  selector: 'app-simulation-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-slate-50 p-6">
      <div class="max-w-6xl mx-auto">

        <!-- Breadcrumb + Header -->
        <div class="mb-6">
          <nav class="flex items-center gap-2 text-xs font-medium text-slate-400 mb-3">
            <a routerLink="/dashboard" class="hover:text-slate-600 transition-colors">Dashboard</a>
            <span>/</span>
            <span class="text-slate-600">Simulazione</span>
            @if (simId()) {
              <span>/</span>
              <span class="font-mono text-blue-600">{{ simId() }}</span>
            }
          </nav>
        </div>

        <!-- Inline error banner (replaces alert()) -->
        @if (errorMsg()) {
          <div class="mb-4 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">
            <svg class="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            <span>{{ errorMsg() }}</span>
            <button (click)="errorMsg.set(null)" class="ml-auto text-red-400 hover:text-red-600 font-bold flex-shrink-0">✕</button>
          </div>
        }

        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

          <!-- Top bar -->
          <div class="bg-slate-900 px-8 py-6 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 class="text-xl font-bold">Dettaglio Simulazione</h1>
              <p class="text-slate-400 font-mono text-xs mt-1">{{ simId() }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              @if (getExperimentParams()) {
                <button (click)="cloneAndRelaunch()"
                  class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow transition-colors flex items-center gap-2">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/>
                  </svg>
                  Clona e Rilancia
                </button>
              }
              <a routerLink="/dashboard"
                class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                Dashboard
              </a>
            </div>
          </div>

          <div class="p-8">
            @if (isLoading()) {
              <div class="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                <svg class="animate-spin h-10 w-10 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span class="font-medium">Caricamento dati simulazione...</span>
              </div>
            } @else {
              <div class="space-y-8">

                <!-- Status + Actions bar -->
                <div class="flex flex-col md:flex-row items-start md:items-center justify-between p-5 rounded-xl border bg-slate-50 border-slate-200 gap-4">
                  <div>
                    <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Stato</p>
                    <p class="text-xl font-extrabold flex items-center gap-2"
                      [ngClass]="{
                        'text-emerald-600': isStatus('COMPLETED'),
                        'text-red-600': isStatus('FAILED') || isStatus('ABORTED'),
                        'text-amber-500': isStatus('RUNNING') || isStatus('PENDING')
                      }">
                      @if (isStatus('RUNNING') || isStatus('PENDING')) {
                        <span class="relative flex h-4 w-4">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-4 w-4 bg-amber-500"></span>
                        </span>
                      }
                      {{ statusData()?.status || 'Sconosciuto' }}
                      @if (isStatus('RUNNING') || isStatus('PENDING')) {
                        <span class="text-base text-slate-600 font-mono bg-white px-2 py-0.5 rounded-lg border border-slate-200">
                          {{ statusData()?.progress || 0 }}%
                        </span>
                      }
                    </p>
                  </div>

                  <div class="flex flex-wrap gap-2 w-full md:w-auto">
                    @if (isStatus('COMPLETED') && resultsData()) {
                      <button (click)="download(resultsData()!.graphs_zip_url)"
                        class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-xl shadow transition-all flex items-center gap-2 text-sm">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                        </svg>
                        ZIP Grafici
                      </button>
                      <button (click)="download(resultsData()!.raw_file_url)"
                        class="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 px-5 rounded-xl shadow transition-all flex items-center gap-2 text-sm">
                        <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        Raw Spikes (JSON)
                      </button>
                    }
                    @if (isStatus('RUNNING') || isStatus('PENDING')) {
                      @if (!confirmAbort()) {
                        <button (click)="confirmAbort.set(true)"
                          class="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-xl shadow transition-all flex items-center gap-2 text-sm">
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>
                          </svg>
                          Interrompi
                        </button>
                      } @else {
                        <div class="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">
                          <span class="text-xs font-bold text-red-700">Confermi l'interruzione?</span>
                          <button (click)="abortSimulation()"
                            [disabled]="isAborting()"
                            class="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors hover:bg-red-700">
                            {{ isAborting() ? '...' : 'Sì, interrompi' }}
                          </button>
                          <button (click)="confirmAbort.set(false)"
                            class="text-slate-500 text-xs font-bold px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                            No
                          </button>
                        </div>
                      }
                    }
                  </div>
                </div>

                <!-- Experiment metadata -->
                @if (getExperimentParams()) {
                  <div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div class="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
                      <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                      </svg>
                      <h2 class="text-base font-bold text-slate-800">Protocollo Sperimentale</h2>
                    </div>
                    <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Rete</h3>
                        <p class="font-mono font-bold text-blue-600 text-base border-b border-slate-100 pb-2">
                          {{ networkData()?.name || resultsData()?.network_name || statusData()?.network_id || 'N/A' }}
                        </p>
                        @if (networkData()) {
                          <div class="mt-3 space-y-2">
                            <div class="flex flex-wrap gap-2 text-[11px]">
                              <span class="bg-blue-50 text-blue-700 px-2 py-1 rounded-md font-mono font-bold">{{ networkNodeCount() | number }} neuroni</span>
                              <span class="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md font-mono font-bold">{{ networkEdgeCount() | number }} sinapsi</span>
                              <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-md font-mono">{{ networkPopulations().length }} popolazioni</span>
                            </div>
                            <div class="flex flex-wrap gap-1.5">
                              @for (p of networkPopulations(); track p.id) {
                                <span class="text-[10px] font-mono bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded">
                                  {{ p.id }} <span class="text-slate-400">×{{ p.size }}</span>
                                </span>
                              }
                            </div>
                            <button type="button" (click)="showNetworkModal.set(true)"
                              class="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline">
                              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                              Vedi dettagli completi rete
                            </button>
                          </div>
                        }
                        @if (getParamKeys().length > 0) {
                          <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-5 mb-2">Parametri Extra</h3>
                          <div class="bg-slate-50 rounded-lg p-3 font-mono text-xs text-slate-600 border border-slate-200">
                            @for (key of getParamKeys(); track key) {
                              <div class="flex justify-between py-1 border-b border-slate-200 last:border-0">
                                <span>{{ key }}:</span>
                                <span class="font-bold text-slate-800">{{ getExperimentParams()[key] | json }}</span>
                              </div>
                            }
                          </div>
                        }
                      </div>
                      <div>
                        <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Dispositivi di Stimolo</h3>
                        @if (getExperimentParams()?.builtin === 'cerebellum_conditioning') {
                          <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs font-mono text-indigo-800 space-y-1">
                            <p class="font-bold text-indigo-700 mb-2">Built-in stimoli cerebellar conditioning</p>
                            <p>• PA_aud / PA_vis — Poisson 30 Hz × 80 neuroni (lato A)</p>
                            <p>• PB_aud / PB_vis — Poisson 30 Hz × 80 neuroni (lato B)</p>
                            <p>• IO teaching signal — Poisson 8.5 Hz, finestra 300–600 ms/trial</p>
                            <p class="text-indigo-500 mt-1">{{ getExperimentParams()?.n_train ?? 20 }} training trials · {{ getExperimentParams()?.n_test ?? 20 }} test/condizione</p>
                          </div>
                        } @else if (getExperimentParams()?.builtin === 'decision_making') {
                          <p class="text-sm text-slate-500 bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                            Built-in Wang decision-making network — stimoli generati internamente dal task worker.
                          </p>
                        } @else if (getExperimentParams()?.builtin === 'cerebellum_msi_race') {
                          <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs font-mono text-indigo-800 space-y-1">
                            <p class="font-bold text-indigo-700 mb-2">Built-in stimoli AV multisensory integration (spike_generator)</p>
                            <p>• <span class="font-bold text-red-600">A</span> — uditivo: Poisson {{ getExperimentParams()?.test?.aud_rate ?? 20 }} Hz × {{ getExperimentParams()?.test?.n_sources ?? 20 }} sorgenti · latenza primo spike {{ getExperimentParams()?.test?.aud_latency_ms ?? 180 }} ms</p>
                            <p>• <span class="font-bold text-blue-600">V</span> — visivo: Poisson {{ getExperimentParams()?.test?.vis_rate ?? 20 }} Hz × {{ getExperimentParams()?.test?.n_sources ?? 20 }} sorgenti · latenza primo spike {{ getExperimentParams()?.test?.vis_latency_ms ?? 220 }} ms</p>
                            <p>• <span class="font-bold text-green-700">A+V</span> — i DUE generatori (A e V) attivi <span class="font-bold">contemporaneamente</span>. NON vengono fusi in un unico treno di spike: restano due treni di Poisson indipendenti che si <span class="font-bold">sommano</span> a valle (conduttanze sinaptiche additive) su GR e DCN_A → 40 afferenti invece di 20 → soglia 15 Hz raggiunta prima (facilitazione/coattivazione).</p>
                            <p class="text-indigo-600 mt-1">Ogni stimolo → GR (fixed_indegree 4) e → DCN_A (all_to_all, peso {{ getExperimentParams()?.test?.mf_dcn_weight_low ?? 0.34 }}–{{ getExperimentParams()?.test?.mf_dcn_weight_high ?? 0.40 }}). Mix trial: V/A/AV/CATCH ≈ 30/30/30/10%.</p>
                            <p class="text-indigo-500 mt-1">Training: CS→GR Poisson {{ getExperimentParams()?.train?.cs_rate ?? 20 }} Hz × {{ getExperimentParams()?.train?.cs_n_sources ?? 20 }} · US→IO_A {{ getExperimentParams()?.train?.us_rate ?? 8.5 }} Hz × {{ getExperimentParams()?.train?.us_n_sources ?? 10 }} (climbing-fiber teaching).</p>
                          </div>
                        } @else if (getExperimentParams()?.inputs?.devices?.length) {
                          <div class="space-y-2">
                            @for (dev of getExperimentParams().inputs.devices; track dev.id) {
                              <div class="bg-blue-50 border border-blue-100 rounded-lg p-3">
                                <div class="flex justify-between items-center mb-1">
                                  <span class="font-bold text-blue-800 text-sm">{{ dev.id }}</span>
                                  <span class="text-[10px] bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full font-mono">{{ dev.model }}</span>
                                </div>
                                <div class="text-xs font-mono text-slate-600 bg-white p-2 rounded border border-blue-50">
                                  {{ dev.params | json }}
                                </div>
                              </div>
                            }
                          </div>
                        } @else {
                          <p class="text-sm text-slate-500 italic bg-slate-50 p-4 rounded-lg border border-slate-100">
                            Nessuno stimolo esterno.
                          </p>
                        }
                      </div>
                    </div>
                  </div>
                }

                <!-- Results section -->
                @if (isStatus('COMPLETED')) {

                  <!-- BUILT-IN EXPERIMENT RESULTS -->
                  @if (resultsData()?.experiment_metrics || resultsData()?.experiment_graphs?.length) {
                    <div>
                      <h2 class="text-xl font-extrabold text-slate-800 mb-5 flex items-center gap-2 border-b border-slate-200 pb-4">
                        <svg class="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                        </svg>
                        @if (resultsData()?.experiment_metrics?.experiment === 'cerebellar_conditioning') {
                          Risultati Condizionamento Cerebellare
                        } @else {
                          Risultati Esperimento (Decision-Making)
                        }
                      </h2>

                      @if (resultsData()?.experiment_metrics; as em) {
                        @if (em.experiment === 'cerebellar_conditioning') {
                          <!-- Cerebellar conditioning summary cards -->
                          <div class="mb-6 space-y-4">
                            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                                <p class="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Train Trials</p>
                                <p class="text-xl font-black text-emerald-800">{{ em.n_train }}</p>
                              </div>
                              <div class="bg-teal-50 border border-teal-200 rounded-xl p-3 text-center">
                                <p class="text-[9px] font-bold text-teal-600 uppercase tracking-wider">Test / Condizione</p>
                                <p class="text-xl font-black text-teal-800">{{ em.n_test_per_condition }}</p>
                              </div>
                              @for (cond of conditioningConditions(em); track cond.label) {
                                <div class="bg-white border border-slate-200 rounded-xl p-3 text-center">
                                  <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider capitalize">{{ cond.label }}</p>
                                  <p class="text-lg font-black" [ngClass]="cond.acc >= 70 ? 'text-emerald-600' : cond.acc >= 50 ? 'text-amber-600' : 'text-red-600'">
                                    {{ cond.acc | number:'1.0-0' }}%
                                  </p>
                                  <p class="text-[9px] text-slate-400 mt-0.5">accuracy</p>
                                </div>
                              }
                            </div>
                            <!-- Median RT per condition -->
                            @if (em.median_rt_ms) {
                              <div class="grid grid-cols-3 gap-3">
                                @for (cond of conditioningConditions(em); track cond.label) {
                                  <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                                    <p class="text-[9px] font-bold text-slate-500 uppercase tracking-wider capitalize">RT Mediano — {{ cond.label }}</p>
                                    <p class="text-base font-black text-slate-800">{{ cond.rt ?? '—' }}<span class="text-[10px] text-slate-400 ml-0.5">ms</span></p>
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        } @else {
                          <!-- Decision-making summary cards (unchanged) -->
                          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                            <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-center">
                              <p class="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">Modalità</p>
                              <p class="text-sm font-black text-indigo-800 mt-0.5 capitalize">{{ em.modality }}</p>
                            </div>
                            <div class="bg-white border border-slate-200 rounded-xl p-3 text-center">
                              <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Trial</p>
                              <p class="text-lg font-black text-slate-800">{{ em.num_trials }}</p>
                            </div>
                            <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                              <p class="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">RT Mediano</p>
                              <p class="text-lg font-black text-emerald-700">{{ em.median_response_time_ms ?? '—' }}<span class="text-[10px] text-slate-400"> ms</span></p>
                            </div>
                            <div class="bg-white border border-slate-200 rounded-xl p-3 text-center">
                              <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">RT Medio</p>
                              <p class="text-lg font-black text-slate-800">{{ em.mean_response_time_ms ?? '—' }}<span class="text-[10px] text-slate-400"> ms</span></p>
                            </div>
                            <div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                              <p class="text-[9px] font-bold text-blue-400 uppercase tracking-wider">Rate A</p>
                              <p class="text-lg font-black text-blue-700">{{ em.avg_rate_A_hz }}<span class="text-[10px] text-slate-400"> Hz</span></p>
                            </div>
                            <div class="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                              <p class="text-[9px] font-bold text-red-400 uppercase tracking-wider">Rate B</p>
                              <p class="text-lg font-black text-red-700">{{ em.avg_rate_B_hz }}<span class="text-[10px] text-slate-400"> Hz</span></p>
                            </div>
                          </div>
                        }
                      }

                      @if (resultsData()?.experiment_graphs?.length) {
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          @for (g of resultsData()!.experiment_graphs!; track g.label) {
                            <div class="bg-white border border-indigo-200 rounded-xl p-4 shadow-sm relative overflow-hidden">
                              <div class="absolute top-0 left-0 w-full h-0.5 bg-indigo-500"></div>
                              <h3 class="text-sm font-bold text-slate-600 uppercase text-center mt-1 mb-3 capitalize">{{ g.label }}</h3>
                              <img [src]="g.url" loading="lazy" [alt]="g.label"
                                class="w-full h-auto rounded-lg object-contain bg-white min-h-[220px] shadow-inner"/>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }

                <!-- ACCURACY METRICS -->
                  @if (resultsData()?.accuracy_metrics?.metrics) {
                    <div>
                      <h2 class="text-xl font-extrabold text-slate-800 mb-5 flex items-center gap-2 border-b border-slate-200 pb-4">
                        <svg class="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>
                        </svg>
                        Accuratezza Decisionale
                      </h2>
                      <div class="space-y-6">
                        @for (metric of resultsData()!.accuracy_metrics!.metrics; track metric.comparison) {
                          <div class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                            <div class="bg-purple-50 p-6 flex flex-col md:flex-row items-center gap-6 border-b border-purple-100">
                              <div class="relative w-28 h-28 flex items-center justify-center bg-white rounded-full shadow-inner border-4 flex-shrink-0"
                                [ngClass]="metric.accuracy_percent >= 80 ? 'border-emerald-400' : metric.accuracy_percent >= 50 ? 'border-amber-400' : 'border-red-400'">
                                <span class="text-2xl font-black text-slate-800">{{ metric.accuracy_percent }}<span class="text-sm text-slate-500">%</span></span>
                              </div>
                              <div class="flex-1 text-center md:text-left">
                                <h3 class="text-xl font-bold text-purple-900 mb-3">{{ metric.comparison }}</h3>
                                <div class="flex flex-wrap gap-3 justify-center md:justify-start">
                                  <div class="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-purple-100 text-center">
                                    <p class="text-[9px] font-bold text-slate-400 uppercase">Trial Validi</p>
                                    <p class="text-lg font-black text-slate-800">{{ metric.total_valid_trials }}</p>
                                  </div>
                                  <div class="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-emerald-100 text-center">
                                    <p class="text-[9px] font-bold text-slate-400 uppercase">Successi</p>
                                    <p class="text-lg font-black text-emerald-600">{{ metric.correct_trials }}</p>
                                  </div>
                                  <div class="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-red-100 text-center">
                                    <p class="text-[9px] font-bold text-slate-400 uppercase">Errori</p>
                                    <p class="text-lg font-black text-red-600">{{ metric.total_valid_trials - metric.correct_trials }}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <button
                              class="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-slate-600 bg-slate-50 border-t border-slate-200 hover:bg-slate-100 transition-colors"
                              (click)="toggleTrialTable(metric.comparison)">
                              <span>{{ expandedTrials().has(metric.comparison) ? 'Nascondi' : 'Mostra' }} dettagli trial ({{ metric.total_valid_trials }})</span>
                              <svg class="w-4 h-4 transition-transform" [class.rotate-180]="expandedTrials().has(metric.comparison)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                              </svg>
                            </button>
                            @if (expandedTrials().has(metric.comparison)) {
                              <div class="overflow-x-auto">
                                <table class="w-full text-sm text-left">
                                  <thead class="text-[10px] text-slate-500 uppercase bg-slate-100">
                                    <tr>
                                      <th class="px-5 py-3">Trial</th>
                                      <th class="px-5 py-3">Cond.</th>
                                      <th class="px-5 py-3">Stimoli Attivi</th>
                                      <th class="px-5 py-3">Atteso</th>
                                      <th class="px-5 py-3">Risultato</th>
                                      <th class="px-5 py-3 text-right">Margine</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    @for (trial of metric.trial_details; track trial.trial) {
                                      <tr class="border-b border-slate-100 font-medium"
                                        [ngClass]="trial.is_correct ? 'bg-emerald-50/40 hover:bg-emerald-50 text-emerald-900' : 'bg-red-50/40 hover:bg-red-50 text-red-900'">
                                        <td class="px-5 py-3">{{ trial.trial }}</td>
                                        <td class="px-5 py-3">
                                          @if (trial.condition_label) {
                                            <span class="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono">{{ trial.condition_label }}</span>
                                          } @else { <span class="text-slate-400">—</span> }
                                        </td>
                                        <td class="px-5 py-3 font-mono text-xs">{{ trial.active_stimuli.join(', ') || '(catch)' }}</td>
                                        <td class="px-5 py-3">{{ trial.expected_winner || 'TIE' }}</td>
                                        <td class="px-5 py-3 font-bold flex items-center gap-1.5">
                                          @if (trial.is_correct) {
                                            <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                                            </svg>
                                          } @else {
                                            <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                            </svg>
                                          }
                                          {{ trial.actual_winner || 'TIE' }}
                                        </td>
                                        <td class="px-5 py-3 text-right font-mono text-xs">{{ trial.net_evidence }} sp.</td>
                                      </tr>
                                    }
                                  </tbody>
                                </table>
                              </div>
                            }
                          </div>
                        }
                      </div>
                    </div>
                  }

                  <!-- RACE MODEL INEQUALITY -->
                  @if (resultsData()?.race_model_graphs?.length) {
                    <div>
                      <h2 class="text-xl font-extrabold text-slate-800 mb-5 flex items-center gap-2 border-b border-slate-200 pb-4">
                        <svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                        </svg>
                        Race Model Inequality (Miller 1982)
                      </h2>
                      <div class="space-y-6">
                        @for (rmi of resultsData()!.race_model_graphs!; track rmi.population) {
                          <div class="bg-white border border-blue-200 rounded-2xl shadow-sm overflow-hidden">
                            <div class="bg-blue-50 px-6 py-4 border-b border-blue-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div>
                                <h3 class="text-lg font-bold text-blue-900">{{ rmi.population }}</h3>
                                <p class="text-xs text-slate-500 mt-0.5">First-spike latency CDF per condizione sensoriale</p>
                              </div>
                              @if (getRmiResultFor(rmi.population); as result) {
                                <div class="flex flex-wrap gap-3">
                                  <div class="bg-white px-3 py-1.5 rounded-lg border border-blue-100 text-center">
                                    <p class="text-[9px] font-bold text-blue-400 uppercase">n_V</p>
                                    <p class="text-base font-black text-slate-800">{{ result.n_V }}</p>
                                  </div>
                                  <div class="bg-white px-3 py-1.5 rounded-lg border border-red-100 text-center">
                                    <p class="text-[9px] font-bold text-red-400 uppercase">n_A</p>
                                    <p class="text-base font-black text-slate-800">{{ result.n_A }}</p>
                                  </div>
                                  <div class="bg-white px-3 py-1.5 rounded-lg border border-emerald-100 text-center">
                                    <p class="text-[9px] font-bold text-emerald-400 uppercase">n_AV</p>
                                    <p class="text-base font-black text-slate-800">{{ result.n_AV }}</p>
                                  </div>
                                  <div class="px-3 py-1.5 rounded-lg border text-center"
                                    [ngClass]="result.has_facilitation ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'">
                                    <p class="text-[9px] font-bold text-slate-400 uppercase">RMI</p>
                                    <p class="text-xs font-black"
                                      [ngClass]="result.has_facilitation ? 'text-emerald-700' : 'text-red-600'">
                                      {{ result.has_facilitation ? 'Facilitation ✓' : 'No Facilitation' }}
                                    </p>
                                  </div>
                                  <div class="bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-center">
                                    <p class="text-[9px] font-bold text-slate-400 uppercase">Max Violation</p>
                                    <p class="text-sm font-black text-slate-800 font-mono">{{ result.max_rmi_violation }}</p>
                                  </div>
                                </div>
                              }
                            </div>
                            <div class="p-4">
                              <img [src]="rmi.url" loading="lazy" [alt]="'Race Model - ' + rmi.population"
                                class="w-full h-auto rounded-lg bg-white shadow-inner"/>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  }

                  <!-- OUTPUT POPULATIONS & RESPONSE TIMES -->
                  @if (responsePairs().length) {
                    <div>
                      <h2 class="text-xl font-extrabold text-slate-800 mb-2 flex items-center gap-2 border-b border-slate-200 pb-4">
                        <svg class="w-6 h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                        </svg>
                        Popolazioni di Output & Tempi di Risposta
                      </h2>
                      <p class="text-sm text-slate-500 mb-6">
                        Per ogni coppia di popolazioni di output, l'attivazione è mostrata con le finestre
                        di stimolo colorate per condizione (così vedi a quale input risponde ciascuna popolazione),
                        e la CDF dei tempi di risposta è separata per condizione.
                      </p>

                      <div class="space-y-8">
                        @for (rp of responsePairs(); track rp.pair) {
                          <div class="bg-white border border-cyan-200 rounded-2xl shadow-sm overflow-hidden">
                            <div class="bg-cyan-50 px-6 py-4 border-b border-cyan-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                              <h3 class="text-lg font-bold text-cyan-900">{{ rp.info?.label || rp.pair }}</h3>
                              @if (rp.info?.median_by_condition) {
                                <div class="flex flex-wrap gap-2">
                                  @for (m of medianEntries(rp.info.median_by_condition); track m.cond) {
                                    <div class="bg-white px-3 py-1.5 rounded-lg border border-cyan-100 text-center">
                                      <p class="text-[9px] font-bold text-cyan-400 uppercase tracking-wider">{{ m.cond }}</p>
                                      <p class="text-sm font-black text-slate-800">{{ m.val }}<span class="text-[10px] text-slate-400"> ms</span></p>
                                    </div>
                                  }
                                </div>
                              }
                            </div>
                            <div class="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
                              @if (rp.activationUrl) {
                                <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                                  <p class="text-[10px] font-bold text-slate-500 uppercase text-center mb-2">Attivazione per condizione</p>
                                  <img [src]="rp.activationUrl" loading="lazy" alt="activation"
                                    class="w-full h-auto rounded-lg object-contain bg-white min-h-[220px]"/>
                                </div>
                              }
                              @if (rp.cdfUrl) {
                                <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                                  <p class="text-[10px] font-bold text-slate-500 uppercase text-center mb-2">CDF dei Tempi di Risposta</p>
                                  <img [src]="rp.cdfUrl" loading="lazy" alt="response-time cdf"
                                    class="w-full h-auto rounded-lg object-contain bg-white min-h-[220px]"/>
                                </div>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  }

                  <!-- DIFFERENTIAL GRAPHS -->
                  @if (resultsData()?.differential_graphs?.length) {
                    <div>
                      <h2 class="text-xl font-bold text-slate-800 mb-5 flex items-center gap-2 border-b border-slate-200 pb-4">
                        <svg class="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/>
                        </svg>
                        Analisi Differenziale (Noise Subtracted)
                      </h2>
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        @for (diff of resultsData()!.differential_graphs!; track diff.label) {
                          <div class="bg-white border border-purple-200 rounded-xl p-4 shadow-sm relative overflow-hidden">
                            <div class="absolute top-0 left-0 w-full h-0.5 bg-purple-500"></div>
                            <h3 class="text-sm font-bold text-slate-600 uppercase text-center mt-1 mb-3">{{ diff.label }}</h3>
                            <img [src]="diff.url" loading="lazy" [alt]="diff.label"
                              class="w-full h-auto rounded-lg object-contain bg-white min-h-[200px] shadow-inner"/>
                          </div>
                        }
                      </div>
                    </div>
                  }

                  <!-- RAW POPULATION GRAPHS -->
                  @if (resultsData()?.population_graphs?.length) {
                    <div>
                      <h2 class="text-xl font-bold text-slate-800 mb-5 flex items-center gap-2 border-b border-slate-200 pb-4">
                        <svg class="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/>
                        </svg>
                        Raster Plots & PSTH per Popolazione
                      </h2>
                      <div class="space-y-8">
                        @for (pop of resultsData()!.population_graphs!; track pop.population_id) {
                          <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm relative overflow-hidden">
                            <div class="absolute left-0 top-0 w-1 h-full bg-emerald-500"></div>
                            <h3 class="text-lg font-extrabold text-slate-700 mb-4 ml-2">
                              <span class="font-mono text-emerald-600">{{ pop.population_id }}</span>
                            </h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                              <div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                <p class="text-[10px] font-bold text-slate-500 uppercase text-center mb-2">Raster Plot</p>
                                <img [src]="pop.raster_url" loading="lazy"
                                  class="w-full h-auto rounded-lg object-contain bg-white min-h-[180px]"/>
                              </div>
                              <div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                <p class="text-[10px] font-bold text-slate-500 uppercase text-center mb-2">Firing Rate (PSTH)</p>
                                <img [src]="pop.histogram_url" loading="lazy"
                                  class="w-full h-auto rounded-lg object-contain bg-white min-h-[180px]"/>
                              </div>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  } @else {
                    <div class="bg-blue-50 text-blue-700 p-5 rounded-xl border border-blue-200 text-center text-sm font-medium">
                      Nessun grafico di popolazione disponibile.
                    </div>
                  }

                } @else if (isStatus('RUNNING') || isStatus('PENDING')) {
                  <div class="text-center py-10">
                    <p class="text-amber-600 font-bold bg-amber-50 p-4 rounded-xl inline-block border border-amber-200 text-sm">
                      Elaborazione NEST in corso... i grafici appariranno al completamento.
                    </p>
                  </div>
                } @else {
                  <div class="text-center py-10">
                    <p class="text-red-600 font-bold bg-red-50 p-4 rounded-xl inline-block border border-red-200 text-sm">
                      La simulazione ha fallito o è stata interrotta. Nessun risultato disponibile.
                    </p>
                  </div>
                }

              </div>
            }
          </div>
        </div>

      </div>
    </div>

    <!-- Network details modal (read-only) -->
    @if (showNetworkModal() && networkData()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
           (click)="showNetworkModal.set(false)">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h2 class="text-lg font-bold text-slate-800">{{ networkData()?.name }}</h2>
              <p class="text-xs text-slate-500">{{ networkData()?.description || 'Dettagli completi della rete (sola lettura)' }}</p>
            </div>
            <button type="button" (click)="showNetworkModal.set(false)"
              class="text-slate-400 hover:text-slate-700 w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="p-6 overflow-y-auto custom-scrollbar space-y-6">
            <div class="flex flex-wrap gap-2 text-xs">
              <span class="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg font-mono font-bold">{{ networkNodeCount() | number }} neuroni</span>
              <span class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg font-mono font-bold">{{ networkEdgeCount() | number }} sinapsi</span>
            </div>

            <div>
              <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Popolazioni ({{ networkPopulations().length }})</h3>
              <div class="space-y-2">
                @for (p of networkPopulations(); track p.id) {
                  <div class="border border-slate-200 rounded-lg p-3">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-bold text-slate-800 text-sm">{{ p.id }}</span>
                      <span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono">{{ p.neuron_model }} · ×{{ p.size }}</span>
                    </div>
                    @if (asJson(p.params) !== '{}') {
                      <pre class="text-[11px] font-mono text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 overflow-x-auto whitespace-pre-wrap">{{ asJson(p.params) }}</pre>
                    }
                  </div>
                }
              </div>
            </div>

            <div>
              <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Proiezioni ({{ networkProjections().length }})</h3>
              <div class="space-y-2">
                @for (pr of networkProjections(); track $index) {
                  <div class="border border-slate-200 rounded-lg p-3">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-mono text-sm text-slate-800"><b>{{ pr.source }}</b> → <b>{{ pr.target }}</b></span>
                      <span class="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-mono">{{ pr.rule }}{{ pr.indegree ? ' · in=' + pr.indegree : '' }}{{ pr.outdegree ? ' · out=' + pr.outdegree : '' }}</span>
                    </div>
                    <div class="text-[10px] text-slate-400 font-mono mb-1">{{ pr.synapse_model }}</div>
                    @if (asJson(pr.params) !== '{}') {
                      <pre class="text-[11px] font-mono text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 overflow-x-auto whitespace-pre-wrap">{{ asJson(pr.params) }}</pre>
                    }
                  </div>
                }
              </div>
            </div>

            <div>
              <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Parametri biologici</h3>
              <pre class="text-[11px] font-mono text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 overflow-x-auto whitespace-pre-wrap">{{ asJson(networkBioParams()) }}</pre>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class SimulationDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private simulationService = inject(SimulationService);
  private networkService = inject(NetworkService);
  private destroyRef = inject(DestroyRef);

  networkData = signal<any | null>(null);
  showNetworkModal = signal(false);

  simId = signal<string | null>(null);
  isLoading = signal(true);
  isAborting = signal(false);
  confirmAbort = signal(false);
  errorMsg = signal<string | null>(null);

  statusData = signal<SimulationStatus | null>(null);
  resultsData = signal<SimulationResult | null>(null);
  expandedTrials = signal<Set<string>>(new Set());
  private pollingSub?: Subscription;

  toggleTrialTable(comparison: string) {
    this.expandedTrials.update(s => {
      const n = new Set(s);
      n.has(comparison) ? n.delete(comparison) : n.add(comparison);
      return n;
    });
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    this.simId.set(id);
    if (id) this.fetchDetails(id);
  }

  private fetchNetwork(netId: any) {
    if (netId == null || this.networkData()) return;
    this.networkService.getNetworkById(String(netId)).subscribe({
      next: (net) => this.networkData.set(net),
      error: () => {},
    });
  }

  networkNodeCount(): number {
    return countNeurons(this.networkData()?.definition?.topology?.populations);
  }

  networkEdgeCount(): number {
    const topology = this.networkData()?.definition?.topology;
    return countSynapses(topology?.populations, topology?.projections);
  }

  networkPopulations(): any[] {
    return this.networkData()?.definition?.topology?.populations ?? [];
  }
  networkProjections(): any[] {
    return this.networkData()?.definition?.topology?.projections ?? [];
  }
  /** Network biological params (excludes the bulky topology). */
  networkBioParams(): Record<string, any> {
    const def = this.networkData()?.definition ?? {};
    return def.params ?? {};
  }
  asJson(v: any): string {
    return typeof v === 'string' ? v : JSON.stringify(v ?? {}, null, 2);
  }

  fetchDetails(id: string) {
    this.simulationService.getStatus(id).subscribe({
      next: (data) => {
        this.statusData.set(data);
        this.fetchNetwork((data as any).network_id);
        if (data.status === 'RUNNING' || data.status === 'PENDING') {
          this.isLoading.set(false);
          this.startPolling(id);
        } else if (data.status === 'COMPLETED') {
          this.fetchResults(id);
        } else {
          this.isLoading.set(false);
        }
      },
      error: () => {
        this.errorMsg.set('Impossibile recuperare lo stato della simulazione.');
        this.isLoading.set(false);
      },
    });
  }

  startPolling(id: string) {
    this.pollingSub = this.simulationService
      .pollStatus(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data: SimulationStatus) => {
          this.statusData.set(data);
          if (['COMPLETED', 'FAILED', 'ABORTED'].includes(data.status)) {
            this.stopPolling();
            if (data.status === 'COMPLETED') this.fetchResults(id);
          }
        },
      });
  }

  stopPolling() { this.pollingSub?.unsubscribe(); }

  abortSimulation() {
    const id = this.simId();
    if (!id) return;
    this.isAborting.set(true);
    this.stopPolling();
    this.simulationService.abortSimulation(id).subscribe({
      next: () => {
        this.isAborting.set(false);
        this.confirmAbort.set(false);
        this.fetchDetails(id);
      },
      error: () => {
        this.isAborting.set(false);
        this.confirmAbort.set(false);
        this.fetchDetails(id);
      },
    });
  }

  fetchResults(id: string) {
    this.simulationService.getResults(id).subscribe({
      next: (res) => {
        this.resultsData.set(res);
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMsg.set('Impossibile caricare i risultati. Riprova tra qualche momento.');
        this.isLoading.set(false);
      },
    });
  }

  isStatus(target: string): boolean {
    const s = this.statusData()?.status;
    return !!s && s.toUpperCase() === target.toUpperCase();
  }

  getExperimentParams() {
    return this.resultsData()?.experiment_params || this.statusData()?.experiment_params;
  }

  getParamKeys(): string[] {
    const params = this.getExperimentParams();
    if (!params) return [];
    return Object.keys(params).filter(k => !['inputs', 'phases', 'protocol', 'analysis'].includes(k));
  }

  getRmiResultFor(population: string): RaceModelResult | undefined {
    return this.resultsData()?.race_model_data?.race_model?.find(r => r.population === population);
  }

  /** Group response graphs (activation + cdf) by output-population pair. */
  responsePairs(): Array<{ pair: string; activationUrl?: string; cdfUrl?: string; info?: any }> {
    const graphs = this.resultsData()?.response_graphs || [];
    const pops = this.resultsData()?.response_analysis?.populations || [];
    const byPair = new Map<string, { pair: string; activationUrl?: string; cdfUrl?: string; info?: any }>();
    for (const g of graphs) {
      const entry = byPair.get(g.pair) || { pair: g.pair };
      if (g.kind === 'activation') entry.activationUrl = g.url;
      if (g.kind === 'cdf') entry.cdfUrl = g.url;
      byPair.set(g.pair, entry);
    }
    for (const entry of byPair.values()) {
      entry.info = pops.find((p: any) => `${p.pop_a}_${p.pop_b}` === entry.pair);
    }
    return Array.from(byPair.values());
  }

  medianEntries(obj: Record<string, number>): Array<{ cond: string; val: number }> {
    return Object.entries(obj || {}).map(([cond, val]) => ({ cond, val }));
  }

  conditioningConditions(em: any): Array<{ label: string; acc: number; rt: number | null }> {
    const acc = em?.accuracy_pct || {};
    const rt  = em?.median_rt_ms || {};
    return Object.keys(acc).map(label => ({
      label,
      acc: acc[label] ?? 0,
      rt:  rt[label] != null ? Math.round(rt[label]) : null,
    }));
  }

  cloneAndRelaunch() {
    const params = this.getExperimentParams();
    const netId = this.statusData()?.network_id || this.resultsData()?.network_id;

    if (!params) {
      this.errorMsg.set("Impossibile clonare: parametri esperimento non trovati.");
      return;
    }
    if (!netId) {
      this.errorMsg.set("Impossibile clonare: network_id non trovato nei dati.");
      return;
    }

    this.router.navigate(['/simulations/run', netId], {
      state: { cloneParams: params },
    });
  }

  download(url: string) {
    if (url) window.open(url, '_blank');
  }

  ngOnDestroy() { this.stopPolling(); }
}
