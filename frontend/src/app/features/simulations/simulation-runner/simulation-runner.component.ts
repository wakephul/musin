import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormArray,
  FormGroup,
  FormControl,
} from '@angular/forms';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import {
  SimulationService,
  SimulationStatus,
} from '../../../core/services/simulation.service';
import {
  NetworkService,
  NetworkModule,
} from '../../../core/services/network.service';
import { PROTOCOL_PRESETS, ProtocolPreset } from '../../../core/data/presets';

@Component({
  selector: 'app-simulation-runner',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="p-8 max-w-6xl mx-auto min-h-screen">
      <header class="mb-8">
        <nav class="flex items-center gap-2 text-xs font-medium text-slate-400 mb-4">
          <a routerLink="/dashboard" class="hover:text-slate-600 transition-colors">Dashboard</a>
          <span>/</span>
          <span class="text-slate-600">Simulazione</span>
          @if (networkId()) {
            <span>/</span>
            <span class="font-mono text-blue-600 truncate max-w-[200px]">{{ networkId() }}</span>
          }
        </nav>
        <h1 class="text-3xl font-extrabold text-slate-900 tracking-tight">
          Pannello di Simulazione
        </h1>
        <p class="text-slate-500 mt-1">Configura il protocollo sperimentale e lancia la simulazione NEST.</p>
      </header>

      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

        @if (currentStatus() === 'IDLE' || currentStatus() === 'ABORTED' || currentStatus() === 'FAILED') {
          <div class="p-8">

            @if (currentStatus() === 'ABORTED' || currentStatus() === 'FAILED') {
              <div class="mb-6 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-sm font-medium">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                La simulazione precedente è terminata in stato <strong class="ml-1">{{ currentStatus() }}</strong>. Riconfigura e rilancia.
              </div>
            }

            @if (isLoadingModels() || isCloning()) {
              <div class="flex items-center justify-center gap-3 py-16 text-slate-500">
                <svg class="animate-spin h-7 w-7 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span class="font-medium">{{ isCloning() ? 'Ripristino configurazione...' : 'Caricamento modelli NEST...' }}</span>
              </div>
            } @else {
              <form [formGroup]="configForm" (ngSubmit)="launch()" class="space-y-8">

                <!-- PROTOCOL TEMPLATES -->
                <div class="bg-gradient-to-br from-blue-50 to-indigo-50 p-5 rounded-xl border border-blue-100">
                  <div class="flex items-center gap-2 mb-3">
                    <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                    <h3 class="text-xs font-bold text-blue-700 uppercase tracking-widest">Load a Validated Protocol</h3>
                  </div>
                  @if (lockedBuiltin()) {
                    <div class="flex items-center justify-between bg-white border border-blue-300 rounded-lg px-4 py-3">
                      <div class="flex items-center gap-2.5">
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white">
                          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                        </span>
                        <div>
                          <div class="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Protocollo selezionato</div>
                          <div class="text-sm font-bold text-slate-800">{{ lockedProtocolName() }}</div>
                        </div>
                      </div>
                      <button type="button" (click)="unlockProtocol()"
                        class="text-xs font-bold text-slate-500 hover:text-blue-700 hover:underline">Cambia protocollo</button>
                    </div>
                  } @else {
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      @for (preset of protocolPresets; track preset.key) {
                        <button type="button" (click)="loadProtocolPreset(preset)"
                          class="text-left bg-white border border-blue-200 rounded-lg p-3.5 hover:border-blue-400 hover:shadow-sm transition-all group">
                          <div class="flex items-center justify-between mb-1">
                            <span class="text-sm font-bold text-slate-800 group-hover:text-blue-700">{{ preset.name }}</span>
                            <span class="text-[10px] font-bold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">Load →</span>
                          </div>
                          <p class="text-[11px] text-slate-500 leading-snug">{{ preset.tagline }}</p>
                        </button>
                      }
                    </div>
                  }
                  @if (presetNotice()) {
                    <div class="mt-3 flex items-start gap-2 bg-white/70 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800 animate-fade-in">
                      <svg class="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      <span>{{ presetNotice() }}</span>
                    </div>
                  }
                </div>

                <!-- MODE TOGGLE (hidden when a protocol is locked) -->
                @if (!lockedBuiltin()) {
                <div class="flex justify-center">
                  <div class="bg-slate-100 p-1 rounded-xl inline-flex gap-1 border border-slate-200">
                    <button type="button" (click)="setMode('continuous')"
                      class="px-5 py-2 rounded-lg font-semibold text-sm transition-all"
                      [class.bg-white]="simulationMode() === 'continuous'"
                      [class.shadow-sm]="simulationMode() === 'continuous'"
                      [class.text-blue-700]="simulationMode() === 'continuous'"
                      [class.text-slate-500]="simulationMode() !== 'continuous'">
                      Continua (Train/Test)
                    </button>
                    <button type="button" (click)="setMode('trials')"
                      class="px-5 py-2 rounded-lg font-semibold text-sm transition-all"
                      [class.bg-white]="simulationMode() === 'trials'"
                      [class.shadow-sm]="simulationMode() === 'trials'"
                      [class.text-emerald-700]="simulationMode() === 'trials'"
                      [class.text-slate-500]="simulationMode() !== 'trials'">
                      Protocollo a Trial
                    </button>
                    <button type="button" (click)="setMode('experiment')"
                      class="px-5 py-2 rounded-lg font-semibold text-sm transition-all"
                      [class.bg-white]="simulationMode() === 'experiment'"
                      [class.shadow-sm]="simulationMode() === 'experiment'"
                      [class.text-indigo-700]="simulationMode() === 'experiment'"
                      [class.text-slate-500]="simulationMode() !== 'experiment'">
                      Esperimento Built-in
                    </button>
                  </div>
                </div>
                }

                @if (simulationMode() === 'experiment') {
                  <!-- Built-in type selector (hidden when a protocol is locked) -->
                  @if (!lockedBuiltin()) {
                  <div class="flex gap-3 mb-4">
                    <button type="button"
                      (click)="configForm.patchValue({cc_builtin_type: 'decision_making'})"
                      [class]="configForm.get('cc_builtin_type')?.value === 'decision_making'
                        ? 'px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white shadow'
                        : 'px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600'">
                      Audiovisual Decision (Wang)
                    </button>
                    <button type="button"
                      (click)="configForm.patchValue({cc_builtin_type: 'cerebellum_conditioning'})"
                      [class]="configForm.get('cc_builtin_type')?.value === 'cerebellum_conditioning'
                        ? 'px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white shadow'
                        : 'px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600'">
                      Cerebellar Conditioning
                    </button>
                    <button type="button"
                      (click)="configForm.patchValue({cc_builtin_type: 'cerebellum_msi_race'})"
                      [class]="configForm.get('cc_builtin_type')?.value === 'cerebellum_msi_race'
                        ? 'px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white shadow'
                        : 'px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600'">
                      AV Multisensory Integration
                    </button>
                  </div>
                  }

                  @if (configForm.get('cc_builtin_type')?.value === 'cerebellum_conditioning') {
                  <!-- BUILT-IN: Cerebellar Conditioning -->
                  <div class="bg-white border border-emerald-200 rounded-2xl overflow-hidden">
                    <div class="bg-gradient-to-br from-emerald-600 to-teal-700 px-6 py-5 text-white">
                      <h3 class="text-lg font-extrabold flex items-center gap-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
                        </svg>
                        Cerebellar Conditioning (Train + Test)
                      </h3>
                      <p class="text-emerald-100 text-xs mt-1 leading-relaxed">
                        Training: plasticity ON — random auditory or visual trial per trial.<br/>
                        Test: plasticity OFF — auditory / visual / audiovisual (20 trials each).<br/>
                        Each trial = 1000 ms stimulus + 2000 ms ITI. Requires the
                        <strong>Cerebellar Conditioning Network</strong> preset.
                      </p>
                    </div>
                    <div class="p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Training Trials</label>
                        <input type="number" formControlName="cc_n_train"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 outline-none"/>
                        <p class="text-[10px] text-slate-400 mt-1">Default 20 (from network_config.json)</p>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Test Trials (per condition)</label>
                        <input type="number" formControlName="cc_n_test"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 outline-none"/>
                        <p class="text-[10px] text-slate-400 mt-1">20 → 60 test trials total (×3 conditions)</p>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Seed</label>
                        <input type="number" formControlName="cc_seed"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 outline-none"/>
                      </div>
                    </div>
                    <div class="px-6 pb-5">
                      <div class="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-3 text-[11px] text-emerald-800 leading-relaxed">
                        <strong>Estimated duration:</strong>
                        ({{ configForm.get('cc_n_train')?.value || 20 }} train +
                        {{ (configForm.get('cc_n_test')?.value || 20) * 3 }} test) ×
                        3000 ms =
                        <strong>{{ ((+(configForm.get('cc_n_train')?.value || 20) + +(configForm.get('cc_n_test')?.value || 20) * 3) * 3) }} s sim</strong>
                        &nbsp;·&nbsp; GR=2000, PC=100, DCN=50 &nbsp;·&nbsp;
                        LTP=0.05, LTD=−6.0, Init_PFPC=4.0
                      </div>
                    </div>
                  </div>
                  }

                  @if (configForm.get('cc_builtin_type')?.value === 'decision_making') {
                  <!-- BUILT-IN EXPERIMENT: Audiovisual Decision-Making -->
                  <div class="bg-white border border-indigo-200 rounded-2xl overflow-hidden">
                    <div class="bg-gradient-to-br from-indigo-600 to-blue-700 px-6 py-5 text-white">
                      <h3 class="text-lg font-extrabold flex items-center gap-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                        </svg>
                        Audiovisual Decision-Making (Wang Attractor)
                      </h3>
                      <p class="text-indigo-100 text-xs mt-1 leading-relaxed">
                        Auditory (150 ms) and visual (220 ms) evidence drive two competing populations.
                        The worker builds the exact NEST 3.8 network and computes response-time CDFs.
                        Requires the <strong>Audiovisual Decision Network</strong> preset.
                      </p>
                    </div>
                    <div class="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Modalità Sensoriale</label>
                        <select formControlName="dm_modality"
                          class="w-full text-sm p-2.5 border border-slate-300 rounded-lg bg-white font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
                          <option value="audiovisual">Audiovisual (merge) — fastest</option>
                          <option value="auditory">Auditory only (150 ms)</option>
                          <option value="visual">Visual only (220 ms)</option>
                        </select>
                        <p class="text-[10px] text-slate-400 mt-1">Confronta i 3 lanci per la facilitazione multisensoriale.</p>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Network Order</label>
                        <input type="number" formControlName="dm_order"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none"/>
                        <p class="text-[10px] text-slate-400 mt-1">400 = scala pubblicata (2×order neuroni/pop). ~2.5 s/trial.</p>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Numero Trial</label>
                        <input type="number" formControlName="dm_num_trials"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none"/>
                        <p class="text-[10px] text-slate-400 mt-1">12 ≈ 30 s. Usa 60 per la run completa pubblicata.</p>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Soglia di Risposta (Hz)</label>
                        <input type="number" formControlName="dm_threshold"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none"/>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Seed</label>
                        <input type="number" formControlName="dm_seed"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none"/>
                      </div>
                      <div class="flex items-end">
                        <div class="w-full bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 text-[11px] text-indigo-700">
                          Durata stimata:
                          <strong>{{ (configForm.get('dm_num_trials')?.value || 0) }} trial × 1000 ms
                          = {{ (configForm.get('dm_num_trials')?.value || 0) }} s sim</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                  }

                  @if (configForm.get('cc_builtin_type')?.value === 'cerebellum_msi_race') {
                  <!-- BUILT-IN: AV Multisensory Integration (Race Model) -->
                  <div class="bg-white border border-violet-200 rounded-2xl overflow-hidden">
                    <div class="bg-gradient-to-br from-violet-600 to-purple-700 px-6 py-5 text-white">
                      <h3 class="text-lg font-extrabold flex items-center gap-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                        </svg>
                        AV Multisensory Integration — Train + Test
                      </h3>
                      <p class="text-violet-100 text-xs mt-1 leading-relaxed">
                        Phase 1 (STDP ON): cerebellar conditioning trains DCN_A.<br/>
                        Phase 2 (STDP OFF): V / A / AV / CATCH trials → Race Model Inequality (Miller 1982).<br/>
                        Aud latency 150 ms · Vis latency 220 ms. Requires <strong>Cerebellar Microcircuit (A/B)</strong> network.
                      </p>
                    </div>
                    <div class="p-6">
                      <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Parametri Esperimento (JSON)</label>
                      <textarea formControlName="experiment_params" spellcheck="false" rows="18"
                        class="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-violet-500 outline-none text-sm text-green-400 font-mono resize-y">
                      </textarea>
                      @if (jsonError()) {
                        <p class="text-red-400 text-xs mt-2 font-bold bg-red-900/40 p-2 rounded">
                          JSON non valido: {{ jsonError() }}
                        </p>
                      }
                      <div class="mt-3 bg-violet-50 border border-violet-100 rounded-lg px-4 py-3 text-[11px] text-violet-800 leading-relaxed">
                        Modifica <code class="font-mono">train.n_trials</code> e <code class="font-mono">test.n_trials</code> per scalare la durata.
                        Legacy: 45 train + 45 test × 1000 ms = 90 s sim.
                      </div>
                    </div>
                  </div>
                  }
                }

                @if (simulationMode() !== 'experiment') {
                <!-- TIMING + METADATA ROW -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

                  <!-- Timing panel -->
                  <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    @if (simulationMode() === 'continuous') {
                      <h3 class="text-xs font-bold text-blue-700 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        Timeline Lineare
                      </h3>
                      <label class="flex items-center gap-3 text-sm font-medium text-slate-700 cursor-pointer bg-white p-3 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors mb-4">
                        <input type="checkbox" formControlName="has_training" class="w-4 h-4 text-blue-600 rounded"/>
                        Abilita fase di Apprendimento (TRAIN)
                      </label>
                      @if (configForm.get('has_training')?.value) {
                        <div class="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label class="block text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">TRAIN (ms)</label>
                            <input type="number" formControlName="train_duration_ms" class="w-full text-base p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"/>
                          </div>
                          <div>
                            <label class="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">TEST (ms)</label>
                            <input type="number" formControlName="test_duration_ms" class="w-full text-base p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-mono"/>
                          </div>
                        </div>
                        <label class="flex items-center gap-2 text-xs text-slate-600 font-medium cursor-pointer">
                          <input type="checkbox" formControlName="disable_plasticity_during_test" class="w-3.5 h-3.5 text-amber-500 rounded"/>
                          Congela pesi sinaptici durante il Test
                        </label>
                      } @else {
                        <div>
                          <label class="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">Durata (ms)</label>
                          <input type="number" formControlName="test_duration_ms" class="w-full text-xl p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-mono"/>
                        </div>
                      }
                    } @else {
                      <h3 class="text-xs font-bold text-emerald-700 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
                        </svg>
                        Protocollo a Trial
                      </h3>
                      <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">N. Trials</label>
                          <input type="number" formControlName="protocol_num_trials" class="w-full text-base p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-mono"/>
                        </div>
                        <div>
                          <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Durata Trial (ms)</label>
                          <input type="number" formControlName="protocol_trial_duration_ms" class="w-full text-base p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-mono"/>
                        </div>
                      </div>
                      <div class="mb-3">
                        <label class="block text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1">
                          Durata Stimolo (ms)
                          <span class="ml-1 text-slate-400 font-normal normal-case">(0 = intera durata trial)</span>
                        </label>
                        <input type="number" formControlName="protocol_stimulus_duration_ms" placeholder="es. 200"
                          class="w-full text-base p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"/>
                        <p class="text-[9px] text-slate-400 mt-1">Durata in ms in cui i dispositivi restano attivi all'interno di ogni trial (finestra di risposta separata).</p>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          ITI — Inter-Trial Interval (ms)
                        </label>
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <label class="block text-[9px] text-slate-400 uppercase mb-1">Min</label>
                            <input type="number" formControlName="protocol_iti_min_ms"
                              class="w-full text-base p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none font-mono"/>
                          </div>
                          <div>
                            <label class="block text-[9px] text-slate-400 uppercase mb-1">Max</label>
                            <input type="number" formControlName="protocol_iti_max_ms"
                              class="w-full text-base p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none font-mono"/>
                          </div>
                        </div>
                        <p class="text-[9px] text-slate-400 mt-1">Se Min = Max: ITI fisso. Se diversi: ITI casuale uniforme per ogni trial (Cavadini 2025: 1000–2500 ms).</p>
                      </div>
                    }
                  </div>

                  <!-- Extra metadata JSON -->
                  <div class="bg-slate-900 p-5 rounded-xl border border-slate-800 flex flex-col">
                    <label class="block text-xs font-bold text-cyan-400 uppercase tracking-widest mb-2">
                      Metadati Extra (JSON)
                    </label>
                    <textarea formControlName="experiment_params" spellcheck="false"
                      class="flex-1 min-h-[160px] w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none text-sm text-green-400 font-mono resize-none">
                    </textarea>
                    @if (jsonError()) {
                      <p class="text-red-400 text-xs mt-2 font-bold bg-red-900/40 p-2 rounded">
                        JSON non valido: {{ jsonError() }}
                      </p>
                    }
                    <!-- File HDF5 -->
                    <div class="mt-4">
                      <label class="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Stimoli Raw (HDF5)</label>
                      <input type="file" id="stimulusFile" (change)="onFileSelected($event)" accept=".h5,.hdf5" class="hidden"/>
                      <label for="stimulusFile"
                        class="flex items-center justify-center px-3 py-2 border border-dashed border-slate-600 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors text-slate-400 text-xs font-medium bg-slate-800/50">
                        <span class="truncate">{{ selectedFileName() || 'Sfoglia file .h5...' }}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <!-- INPUT DEVICES -->
                <div class="bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                  <div class="flex justify-between items-center mb-4">
                    <div>
                      <h3 class="text-base font-bold text-blue-800">Generatori di Stimolo</h3>
                      <p class="text-xs text-slate-500 mt-0.5">Crea i device di input prima di mapparli nel Pool.</p>
                    </div>
                    <button type="button" (click)="addInputDevice()"
                      class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors shadow-sm">
                      + Generatore
                    </button>
                  </div>
                  <div formArrayName="input_devices" class="space-y-3">
                    @for (dev of inputDevices.controls; track $index) {
                      <div [formGroupName]="$index" class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative">
                        <button type="button" (click)="removeInputDevice($index)"
                          class="absolute -top-2.5 -right-2.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-sm z-10">
                          ✕
                        </button>
                        <div class="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">ID Generatore</label>
                            <input type="text" formControlName="id"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"/>
                          </div>
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Modello NEST</label>
                            <select formControlName="model" (change)="onDeviceModelChange($index)"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-medium">
                              @for (mod of availableModules(); track mod.id) {
                                <optgroup [label]="mod.label">
                                  @for (n of mod.neurons; track n.id) {
                                    <option [value]="n.id">{{ n.label }}</option>
                                  }
                                </optgroup>
                              }
                            </select>
                          </div>
                        </div>
                        @if (dev.get('model')?.value) {
                          <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <div class="flex justify-between items-center mb-2">
                              <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Parametri</label>
                            </div>
                            <div [formGroupName]="'params'" class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                              @for (param of getDeviceParamsGroup($index).controls | keyvalue; track param.key) {
                                <div>
                                  <label class="flex justify-between items-center text-[10px] text-slate-600 font-mono mb-0.5">
                                    {{ param.key }}
                                    <button type="button" (click)="removeParam(getDeviceParamsGroup($index), param.key)"
                                      class="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>
                                  </label>
                                  <input type="text" [formControlName]="param.key"
                                    class="w-full text-xs p-1.5 border border-slate-200 rounded outline-none bg-white font-mono focus:ring-2 focus:ring-blue-300"/>
                                </div>
                              }
                            </div>
                            <!-- Inline add-param (replaces window.prompt) -->
                            <div class="flex gap-2 mt-1">
                              <input type="text" #devParamInput placeholder="Nome parametro..."
                                class="flex-1 text-xs p-1.5 border border-dashed border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-400 outline-none"
                                (keyup.enter)="addNamedParam(getDeviceParamsGroup($index), devParamInput); devParamInput.value=''"/>
                              <button type="button"
                                (click)="addNamedParam(getDeviceParamsGroup($index), devParamInput); devParamInput.value=''"
                                class="text-xs font-bold text-blue-600 hover:bg-blue-100 px-2.5 py-1 rounded transition-colors border border-blue-200">
                                + Param
                              </button>
                            </div>
                          </div>
                        }
                      </div>
                    }
                    @if (inputDevices.length === 0) {
                      <div class="p-5 text-center text-blue-400 bg-white border-2 border-dashed border-blue-200 rounded-xl text-sm">
                        Nessun generatore configurato.
                      </div>
                    }
                  </div>
                </div>

                <!-- STOCHASTIC POOL (trial mode only) -->
                @if (simulationMode() === 'trials') {
                  <div class="bg-emerald-50/50 p-5 rounded-xl border border-emerald-100">
                    <div class="flex justify-between items-center mb-4">
                      <div>
                        <h3 class="text-base font-bold text-emerald-800 flex items-center gap-2">
                          Pool Stocastico degli Stimoli
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">Ogni pool è un'estrazione con peso relativo. Usa <strong>condition_label</strong> (es. "V", "A", "AV") per l'analisi RMI.</p>
                      </div>
                      <button type="button" (click)="addStimulusPool()"
                        class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors shadow-sm">
                        + Estrazione
                      </button>
                    </div>
                    <div formArrayName="protocol_stimuli_pool" class="space-y-3">
                      @for (pool of stimuliPool.controls; track $index) {
                        <div [formGroupName]="$index"
                          class="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm relative grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-4 items-center">
                          <button type="button" (click)="removeStimulusPool($index)"
                            class="absolute -top-2.5 -right-2.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-sm z-10">
                            ✕
                          </button>
                          <!-- Weight -->
                          <div class="w-full md:w-28">
                            <label class="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Peso</label>
                            <input type="number" step="any" formControlName="weight"
                              class="w-full text-xl font-bold text-center p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-emerald-700"/>
                          </div>
                          <!-- Condition label -->
                          <div class="w-full md:w-28">
                            <label class="block text-[9px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Cond. Label (RMI)</label>
                            <input type="text" formControlName="condition_label" placeholder="es. V, A, AV"
                              class="w-full text-sm font-bold text-center p-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-indigo-700 font-mono uppercase"/>
                          </div>
                          <!-- Device checkboxes -->
                          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 flex-1">
                            <label class="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Device Attivi</label>
                            <div class="flex flex-wrap gap-2">
                              @for (dev of inputDevices.value; track dev.id) {
                                @if (dev.id) {
                                  <label class="flex items-center gap-1.5 bg-white px-2.5 py-1 border border-slate-300 rounded-lg cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 transition-colors">
                                    <input type="checkbox"
                                      [checked]="pool.get('devices')?.value?.includes(dev.id)"
                                      (change)="toggleDeviceInPool($index, dev.id, $event)"
                                      class="w-3.5 h-3.5 text-emerald-600 rounded"/>
                                    <span class="text-xs font-bold text-slate-700">{{ dev.id }}</span>
                                  </label>
                                }
                              }
                              @if (inputDevices.length === 0) {
                                <span class="text-xs text-slate-400 italic">Aggiungi prima i generatori.</span>
                              }
                            </div>
                            <p class="text-[9px] text-slate-400 mt-1.5">Nessun device selezionato → catch trial (silenzio).</p>
                          </div>
                        </div>
                      }
                      @if (stimuliPool.length === 0) {
                        <div class="p-5 text-center text-emerald-600 bg-white border-2 border-dashed border-emerald-200 rounded-xl text-sm">
                          Nessun pool configurato. Tutti i trial saranno silenziosi.
                        </div>
                      }
                    </div>
                  </div>
                }

                <!-- INPUT CONNECTIONS -->
                <div class="bg-indigo-50/50 p-5 rounded-xl border border-indigo-100">
                  <div class="flex justify-between items-center mb-4">
                    <div>
                      <h3 class="text-base font-bold text-indigo-800">Connessioni degli Stimoli</h3>
                      <p class="text-xs text-slate-500 mt-0.5">Collega i device di input alle popolazioni biologiche.</p>
                    </div>
                    <button type="button" (click)="addInputConnection()"
                      class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors shadow-sm">
                      + Connessione
                    </button>
                  </div>
                  <div formArrayName="input_connections" class="space-y-3">
                    @for (conn of inputConnections.controls; track $index) {
                      <div [formGroupName]="$index" class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative">
                        <button type="button" (click)="removeInputConnection($index)"
                          class="absolute -top-2.5 -right-2.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-sm z-10">
                          ✕
                        </button>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Sorgente</label>
                            <select formControlName="source" class="w-full text-sm p-2 border border-slate-300 rounded-lg bg-white font-mono">
                              @for (dev of inputDevices.value; track dev.id) {
                                @if (dev.id) { <option [value]="dev.id">{{ dev.id }}</option> }
                              }
                            </select>
                          </div>
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target</label>
                            <input type="text" formControlName="target"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg font-mono outline-none focus:ring-2 focus:ring-indigo-500"/>
                          </div>
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Regola</label>
                            <select formControlName="rule" (change)="onInputRuleChange($index)"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg bg-white">
                              <option value="all_to_all">all_to_all</option>
                              <option value="one_to_one">one_to_one</option>
                              <option value="fixed_indegree">fixed_indegree</option>
                              <option value="fixed_outdegree">fixed_outdegree</option>
                            </select>
                          </div>
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Sinapsi</label>
                            <select formControlName="synapse_model" (change)="onConnectionSynapseChange($index)"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg bg-white">
                              @for (mod of availableModules(); track mod.id) {
                                <optgroup [label]="mod.label">
                                  @for (s of mod.synapses; track s.id) {
                                    <option [value]="s.id">{{ s.label }}</option>
                                  }
                                </optgroup>
                              }
                            </select>
                          </div>
                        </div>
                        @if (conn.get('synapse_model')?.value) {
                          <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Parametri Sinapsi</label>
                            <div [formGroupName]="'params'" class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                              @for (param of getConnectionParamsGroup($index).controls | keyvalue; track param.key) {
                                <div>
                                  <label class="flex justify-between items-center text-[10px] text-slate-600 font-mono mb-0.5">
                                    {{ param.key }}
                                    <button type="button" (click)="removeParam(getConnectionParamsGroup($index), param.key)"
                                      class="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>
                                  </label>
                                  <input type="text" [formControlName]="param.key"
                                    class="w-full text-xs p-1.5 border border-slate-200 rounded outline-none bg-white font-mono focus:ring-2 focus:ring-indigo-300"/>
                                </div>
                              }
                            </div>
                            <!-- Inline add-param -->
                            <div class="flex gap-2 mt-1">
                              <input type="text" #connParamInput placeholder="Nome parametro..."
                                class="flex-1 text-xs p-1.5 border border-dashed border-slate-300 rounded font-mono focus:ring-1 focus:ring-indigo-400 outline-none"
                                (keyup.enter)="addNamedParam(getConnectionParamsGroup($index), connParamInput); connParamInput.value=''"/>
                              <button type="button"
                                (click)="addNamedParam(getConnectionParamsGroup($index), connParamInput); connParamInput.value=''"
                                class="text-xs font-bold text-indigo-600 hover:bg-indigo-100 px-2.5 py-1 rounded transition-colors border border-indigo-200">
                                + Param
                              </button>
                            </div>
                          </div>
                        }
                      </div>
                    }
                    @if (inputConnections.length === 0) {
                      <div class="p-5 text-center text-indigo-400 bg-white border-2 border-dashed border-indigo-200 rounded-xl text-sm">
                        Nessuna connessione di input configurata.
                      </div>
                    }
                  </div>
                </div>

                <!-- COGNITIVE ANALYSIS -->
                <div class="bg-purple-50/50 p-5 rounded-xl border border-purple-100">
                  <div>
                    <h3 class="text-base font-bold text-purple-800 mb-0.5">Analisi Cognitiva</h3>
                    <p class="text-xs text-slate-500 mb-4">Sottrazione rumore tonico e analisi Race Model Inequality (Cavadini 2025).</p>
                  </div>

                  <!-- Differential plots -->
                  <div class="mb-5">
                    <div class="flex justify-between items-center mb-3">
                      <label class="text-xs font-bold text-purple-700 uppercase tracking-wider">Grafici Differenziali (pop_a − pop_b)</label>
                      <button type="button" (click)="addDifferentialPlot()"
                        class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition-colors shadow-sm">
                        + Coppia
                      </button>
                    </div>
                    <div formArrayName="differential_plots" class="space-y-2">
                      @for (plot of differentialPlots.controls; track $index) {
                        <div [formGroupName]="$index"
                          class="bg-white p-3 rounded-lg border border-purple-200 shadow-sm relative grid grid-cols-1 md:grid-cols-3 gap-3">
                          <button type="button" (click)="removeDifferentialPlot($index)"
                            class="absolute -top-2.5 -right-2.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-sm z-10">
                            ✕
                          </button>
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pop A (+)</label>
                            <input type="text" formControlName="pop_a" placeholder="es. DCN_A"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 font-mono uppercase"/>
                          </div>
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pop B (−)</label>
                            <input type="text" formControlName="pop_b" placeholder="es. DCN_B"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 font-mono uppercase"/>
                          </div>
                          <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Label</label>
                            <input type="text" formControlName="label" placeholder="es. Decisione Motoria"
                              class="w-full text-sm p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"/>
                          </div>
                        </div>
                      }
                      @if (differentialPlots.length === 0) {
                        <div class="p-4 text-center text-purple-400 bg-white border-2 border-dashed border-purple-200 rounded-xl text-xs">
                          Nessuna coppia differenziale configurata.
                        </div>
                      }
                    </div>
                  </div>

                  <!-- Response-Time CDF (output populations) -->
                  <div class="bg-white p-4 rounded-xl border border-cyan-200 mb-5">
                    <label class="flex items-start gap-2.5 cursor-pointer select-none">
                      <input type="checkbox" formControlName="response_cdf_enabled"
                        class="w-4 h-4 mt-0.5 text-cyan-600 rounded focus:ring-cyan-500"/>
                      <div class="flex-1">
                        <span class="font-bold text-sm text-slate-800">Tempi di risposta + CDF delle popolazioni di output</span>
                        <p class="text-[10px] text-slate-500 mt-0.5">
                          Per ogni coppia differenziale sopra (es. DCN_A vs DCN_B), genera il grafico di attivazione
                          annotato per condizione e la CDF dei tempi di risposta. La risposta è la prima volta che
                          |rate_a − rate_b| supera la soglia in un trial (robusto al baseline tonico).
                        </p>
                      </div>
                    </label>
                    @if (configForm.get('response_cdf_enabled')?.value) {
                      <div class="mt-3 flex items-center gap-3 pl-7">
                        <label class="text-[10px] font-bold text-cyan-600 uppercase tracking-wider">Soglia (Hz)</label>
                        <input type="number" formControlName="response_cdf_threshold"
                          class="w-28 text-sm p-2 border border-cyan-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-cyan-500"/>
                      </div>
                    }
                  </div>

                  <!-- Race Model Inequality -->
                  @if (simulationMode() === 'trials') {
                    <div class="bg-white p-4 rounded-xl border border-purple-200">
                      <div class="flex items-start gap-3 mb-3">
                        <label class="flex items-center gap-2.5 cursor-pointer select-none">
                          <input type="checkbox" formControlName="race_model_enabled"
                            class="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"/>
                          <div>
                            <span class="font-bold text-sm text-slate-800">Abilita Race Model Inequality (RMI)</span>
                            <p class="text-[10px] text-slate-500 mt-0.5">Richiede condizioni "V", "A", "AV" nei pool. Calcola CDF per prima spike latency e testa la Miller (1982) inequality.</p>
                          </div>
                        </label>
                      </div>
                      @if (configForm.get('race_model_enabled')?.value) {
                        <div>
                          <label class="block text-[10px] font-bold text-purple-600 uppercase tracking-wider mb-1.5">
                            Popolazioni di Output da Analizzare (es. DCN_A, DCN_B)
                          </label>
                          <div formArrayName="race_model_populations" class="space-y-2 mb-2">
                            @for (popCtrl of raceModelPopulations.controls; track $index) {
                              <div class="flex gap-2 items-center">
                                <input type="text" [formControlName]="$index" placeholder="es. DCN_A"
                                  class="flex-1 text-sm p-2 border border-purple-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-purple-500 uppercase"/>
                                <button type="button" (click)="raceModelPopulations.removeAt($index)"
                                  class="text-red-400 hover:text-red-600 font-bold text-sm px-2">✕</button>
                              </div>
                            }
                          </div>
                          <button type="button" (click)="addRaceModelPopulation()"
                            class="text-xs font-bold text-purple-600 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors border border-purple-200">
                            + Aggiungi Popolazione
                          </button>
                        </div>
                      }
                    </div>
                  }
                </div>

                }

                <!-- LAUNCH -->
                <div>
                  @if (configForm.invalid && configForm.touched) {
                    <p class="text-red-600 text-sm font-medium bg-red-50 border border-red-200 px-4 py-2.5 rounded-lg mb-3">
                      Completa tutti i campi obbligatori prima di lanciare.
                    </p>
                  }
                  <button type="submit" [disabled]="configForm.invalid"
                    class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-lg font-bold py-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-3">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                    ESEGUI PROTOCOLLO SPERIMENTALE
                  </button>
                </div>
              </form>
            }
          </div>
        }

        <!-- RUNNING / PENDING -->
        @if (currentStatus() === 'RUNNING' || currentStatus() === 'PENDING') {
          <div class="p-10 text-center bg-slate-900 text-white m-2 rounded-2xl">
            <div class="flex items-center justify-center gap-3 mb-3">
              <span class="relative flex h-5 w-5">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-5 w-5 bg-blue-500"></span>
              </span>
              <h2 class="text-2xl font-bold">Integrazione Numerica NEST in corso...</h2>
            </div>
            <p class="text-slate-400 font-mono text-xs mb-8">Job ID: {{ activeSimulationId() }}</p>
            <div class="relative w-full h-8 bg-slate-800 rounded-full overflow-hidden mb-3 border border-slate-700">
              <div class="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-cyan-400 transition-[width] duration-500 ease-linear"
                [style.width.%]="progress()"></div>
            </div>
            <div class="text-right text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-10">
              {{ progress() }}%
            </div>
            <button (click)="abort()"
              class="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 mx-auto">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>
              </svg>
              INTERROMPI
            </button>
          </div>
        }

        <!-- COMPLETED -->
        @if (currentStatus() === 'COMPLETED') {
          <div class="p-10 text-center bg-emerald-50 m-2 rounded-2xl border border-emerald-100">
            <div class="flex items-center justify-center gap-2 mb-2">
              <svg class="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <h2 class="text-2xl font-extrabold text-emerald-800">Simulazione Completata</h2>
            </div>
            <p class="text-slate-500 text-sm mb-8">Job ID: <span class="font-mono">{{ activeSimulationId() }}</span></p>
            <div class="flex flex-col sm:flex-row gap-3 justify-center">
              <a [routerLink]="['/simulations/detail', activeSimulationId()]"
                class="bg-blue-600 hover:bg-blue-700 text-white text-base font-bold py-3 px-7 rounded-xl shadow-md transition-colors">
                VEDI ANALISI E GRAFICI
              </a>
              <button (click)="resetView()"
                class="bg-white border-2 border-slate-200 hover:border-slate-300 text-slate-600 text-base font-bold py-3 px-7 rounded-xl transition-colors">
                Nuova Esecuzione
              </button>
            </div>
          </div>
        }

      </div>
    </div>
  `,
})
export class SimulationRunnerComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly fb = inject(FormBuilder);
  private simulationService = inject(SimulationService);
  private networkService = inject(NetworkService);
  private destroyRef = inject(DestroyRef);

  networkId = signal<string | null>(null);
  activeSimulationId = signal<string | null>(null);
  currentStatus = signal<'IDLE' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED'>('IDLE');
  progress = signal<number>(0);
  jsonError = signal<string | null>(null);
  isLoadingModels = signal(true);
  isCloning = signal(false);
  availableModules = signal<NetworkModule[]>([]);
  selectedFile: File | null = null;
  selectedFileName = signal<string>('');
  simulationMode = signal<'continuous' | 'trials' | 'experiment'>('continuous');

  private pollingSub?: Subscription;
  private clonedParamsToApply: any = null;

  readonly protocolPresets = PROTOCOL_PRESETS;
  presetNotice = signal<string | null>(null);
  // When a built-in protocol is loaded (from the dashboard or a preset card) the
  // experiment is LOCKED: the mode toggle and the built-in-type selector are hidden
  // so the user cannot accidentally switch protocol. `unlockProtocol()` reopens it.
  lockedBuiltin = signal<string | null>(null);
  lockedProtocolName = signal<string | null>(null);

  private readonly BUILTIN_LABELS: Record<string, string> = {
    decision_making: 'Audiovisual Decision (Wang)',
    cerebellum_conditioning: 'Cerebellar Conditioning',
    cerebellum_msi_race: 'AV Multisensory Integration — Train + Test',
  };

  private lockProtocol(builtin: string) {
    this.lockedBuiltin.set(builtin);
    const presetName = this.protocolPresets.find(p => p.payload?.builtin === builtin)?.name;
    this.lockedProtocolName.set(presetName ?? this.BUILTIN_LABELS[builtin] ?? builtin);
  }

  unlockProtocol() {
    this.lockedBuiltin.set(null);
    this.lockedProtocolName.set(null);
    this.presetNotice.set(null);
  }

  readonly defaultExpParams = `{\n  "resolution": 0.1,\n  "seed": 1234\n}`;

  configForm = this.fb.group({
    // Continuous mode
    has_training: [false],
    train_duration_ms: [2000],
    test_duration_ms: [1000, [Validators.required, Validators.min(1)]],
    disable_plasticity_during_test: [true],

    // Trial protocol
    protocol_num_trials: [100, Validators.min(1)],
    protocol_trial_duration_ms: [1500.0, Validators.min(1)],
    protocol_stimulus_duration_ms: [200.0, Validators.min(0)],
    protocol_iti_min_ms: [1000.0, Validators.min(0)],
    protocol_iti_max_ms: [2500.0, Validators.min(0)],
    protocol_stimuli_pool: this.fb.array([]),

    // Analysis
    differential_plots: this.fb.array([]),
    race_model_enabled: [false],
    race_model_populations: this.fb.array([]),
    response_cdf_enabled: [true],
    response_cdf_threshold: [15],

    // Built-in: Wang audiovisual decision-making
    dm_modality: ['audiovisual'],
    dm_order: [400, [Validators.min(10)]],
    dm_num_trials: [12, [Validators.min(1)]],
    dm_threshold: [15, [Validators.min(0)]],
    dm_seed: [1234],
    // Built-in: Cerebellar conditioning
    cc_n_train: [20, [Validators.min(1)]],
    cc_n_test: [20, [Validators.min(1)]],
    cc_seed: [1234],
    cc_builtin_type: ['cerebellum_conditioning'],

    experiment_params: [this.defaultExpParams],
    input_devices: this.fb.array([]),
    input_connections: this.fb.array([]),
  });

  get inputDevices() { return this.configForm.get('input_devices') as FormArray; }
  get inputConnections() { return this.configForm.get('input_connections') as FormArray; }
  get stimuliPool() { return this.configForm.get('protocol_stimuli_pool') as FormArray; }
  get differentialPlots() { return this.configForm.get('differential_plots') as FormArray; }
  get raceModelPopulations() { return this.configForm.get('race_model_populations') as FormArray; }

  getDeviceParamsGroup(index: number): FormGroup {
    return this.inputDevices.at(index).get('params') as FormGroup;
  }
  getConnectionParamsGroup(index: number): FormGroup {
    return this.inputConnections.at(index).get('params') as FormGroup;
  }

  constructor() {
    const nav = this.router.getCurrentNavigation();
    const state = nav?.extras?.state as { cloneParams?: any };
    if (state?.cloneParams) {
      this.clonedParamsToApply = state.cloneParams;
    } else if (history.state?.cloneParams) {
      this.clonedParamsToApply = history.state.cloneParams;
    }
  }

  ngOnInit() {
    this.networkId.set(this.route.snapshot.paramMap.get('id'));
    this.networkService.getModels().subscribe({
      next: (modules) => {
        this.availableModules.set(modules);
        this.isLoadingModels.set(false);
        if (this.clonedParamsToApply) this.applyClonedParams(this.clonedParamsToApply);
      },
      error: () => this.isLoadingModels.set(false),
    });
  }

  private applyClonedParams(p: any) {
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch { return; }
    }
    this.isCloning.set(true);

    // Built-in experiment payload (e.g. Wang decision-making)
    if (p.builtin === 'decision_making') {
      this.setMode('experiment');
      this.lockProtocol('decision_making');
      const dm = p.decision_making || {};
      this.configForm.patchValue({
        cc_builtin_type: 'decision_making',
        dm_modality: dm.modality ?? 'audiovisual',
        dm_order: dm.order ?? 400,
        dm_num_trials: dm.num_trials ?? 12,
        dm_threshold: dm.threshold ?? 15,
        dm_seed: dm.seed ?? 1234,
      });
      this.isCloning.set(false);
      return;
    }

    if (p.builtin === 'cerebellum_conditioning') {
      this.setMode('experiment');
      this.lockProtocol('cerebellum_conditioning');
      this.configForm.patchValue({
        cc_builtin_type: 'cerebellum_conditioning',
        cc_n_train: p.n_train ?? 20,
        cc_n_test: p.n_test ?? 20,
        cc_seed: p.seed ?? 1234,
      });
      this.isCloning.set(false);
      return;
    }

    if (p.builtin === 'cerebellum_msi_race') {
      this.setMode('experiment');
      this.lockProtocol('cerebellum_msi_race');
      this.configForm.patchValue({
        cc_builtin_type: 'cerebellum_msi_race',
        experiment_params: JSON.stringify(p, null, 2),
      });
      this.isCloning.set(false);
      return;
    }

    if (p.inputs?.devices) {
      this.inputDevices.clear();
      p.inputs.devices.forEach((d: any) => {
        const paramsGroup = this.fb.group({});
        if (d.params) {
          Object.keys(d.params).forEach((k) => {
            const val = typeof d.params[k] === 'object' ? JSON.stringify(d.params[k]) : d.params[k];
            paramsGroup.addControl(k, new FormControl(val, Validators.required));
          });
        }
        this.inputDevices.push(this.fb.group({
          id: [d.id, Validators.required],
          model: [d.model, Validators.required],
          params: paramsGroup,
        }));
      });
    }

    if (p.inputs?.connections) {
      this.inputConnections.clear();
      p.inputs.connections.forEach((c: any) => {
        const paramsGroup = this.fb.group({});
        if (c.params) {
          Object.keys(c.params).forEach((k) => {
            const val = typeof c.params[k] === 'object' ? JSON.stringify(c.params[k]) : c.params[k];
            paramsGroup.addControl(k, new FormControl(val, Validators.required));
          });
        }
        this.inputConnections.push(this.fb.group({
          source: [c.source, Validators.required],
          target: [c.target, Validators.required],
          rule: [c.rule || 'all_to_all', Validators.required],
          synapse_model: [c.synapse_model, Validators.required],
          params: paramsGroup,
        }));
      });
    }

    if (p.protocol) {
      this.setMode('trials');
      const itiMin = p.protocol.iti_range_ms?.[0] ?? p.protocol.iti_ms ?? 1000;
      const itiMax = p.protocol.iti_range_ms?.[1] ?? p.protocol.iti_ms ?? 2500;
      this.configForm.patchValue({
        protocol_num_trials: p.protocol.num_trials,
        protocol_trial_duration_ms: p.protocol.trial_duration_ms,
        protocol_stimulus_duration_ms: p.protocol.stimulus_duration_ms ?? 0,
        protocol_iti_min_ms: itiMin,
        protocol_iti_max_ms: itiMax,
      });
      this.stimuliPool.clear();
      if (p.protocol.stimuli_pool) {
        p.protocol.stimuli_pool.forEach((pool: any) => {
          this.stimuliPool.push(this.fb.group({
            devices: [pool.devices || []],
            weight: [pool.weight || 1.0, [Validators.required, Validators.min(0)]],
            condition_label: [pool.condition_label || ''],
          }));
        });
      }
    } else if (p.phases) {
      this.setMode('continuous');
      this.configForm.patchValue({
        has_training: !!p.phases.train_duration_ms,
        train_duration_ms: p.phases.train_duration_ms || 2000,
        test_duration_ms: p.phases.test_duration_ms || 1000,
        disable_plasticity_during_test: p.phases.disable_plasticity_during_test !== false,
      });
    }

    this.differentialPlots.clear();
    if (p.analysis?.differential_plots) {
      p.analysis.differential_plots.forEach((plot: any) => {
        this.differentialPlots.push(this.fb.group({
          pop_a: [plot.pop_a, Validators.required],
          pop_b: [plot.pop_b, Validators.required],
          label: [plot.label || 'Decisione', Validators.required],
        }));
      });
    }

    this.raceModelPopulations.clear();
    if (p.analysis?.race_model?.enabled) {
      this.configForm.patchValue({ race_model_enabled: true });
      (p.analysis.race_model.populations || []).forEach((pop: string) => {
        this.raceModelPopulations.push(new FormControl(pop, Validators.required));
      });
    }

    if (p.analysis?.response_cdf) {
      this.configForm.patchValue({
        response_cdf_enabled: p.analysis.response_cdf.enabled !== false,
        response_cdf_threshold: p.analysis.response_cdf.threshold ?? 15,
      });
    }

    const rootParams = { ...p };
    delete rootParams.inputs;
    delete rootParams.protocol;
    delete rootParams.phases;
    delete rootParams.analysis;
    this.configForm.patchValue({ experiment_params: JSON.stringify(rootParams, null, 2) });

    this.isCloning.set(false);
  }

  /** One-click load of a validated experiment protocol into the form. */
  loadProtocolPreset(preset: ProtocolPreset) {
    this.applyClonedParams(preset.payload);
    this.presetNotice.set(
      `Loaded "${preset.name}". Expects populations: ${preset.requiresPopulations.join(', ')}.`,
    );
  }

  setMode(mode: 'continuous' | 'trials' | 'experiment') {
    this.simulationMode.set(mode);
    if (mode === 'trials' && this.stimuliPool.length === 0) this.addStimulusPool();
  }

  addStimulusPool() {
    this.stimuliPool.push(this.fb.group({
      devices: [[]],
      weight: [1.0, [Validators.required, Validators.min(0)]],
      condition_label: [''],
    }));
  }
  removeStimulusPool(index: number) { this.stimuliPool.removeAt(index); }

  toggleDeviceInPool(poolIndex: number, deviceId: string, event: Event) {
    const isChecked = (event.target as HTMLInputElement).checked;
    const devicesControl = (this.stimuliPool.at(poolIndex) as FormGroup).get('devices') as FormControl;
    const current: string[] = devicesControl.value || [];
    devicesControl.setValue(isChecked
      ? (current.includes(deviceId) ? current : [...current, deviceId])
      : current.filter(id => id !== deviceId));
  }

  addInputDevice() {
    this.inputDevices.push(this.fb.group({
      id: ['', Validators.required],
      model: ['', Validators.required],
      params: this.fb.group({}),
    }));
  }
  removeInputDevice(index: number) { this.inputDevices.removeAt(index); }

  addNamedParam(group: FormGroup, input: HTMLInputElement) {
    const key = input.value.trim();
    if (key && !group.contains(key)) {
      group.addControl(key, new FormControl('', Validators.required));
    }
  }
  removeParam(group: FormGroup, key: string) { group.removeControl(key); }

  onDeviceModelChange(index: number) {
    const selectedModelId = this.inputDevices.at(index).get('model')?.value;
    const paramsGroup = this.getDeviceParamsGroup(index);
    Object.keys(paramsGroup.controls).forEach(k => paramsGroup.removeControl(k));
    const model = this.availableModules().flatMap(m => m.neurons).find(n => n.id === selectedModelId);
    if (model?.default_params) {
      Object.entries(model.default_params).forEach(([key, value]) =>
        paramsGroup.addControl(key, new FormControl(value, Validators.required)));
    }
  }

  addInputConnection() {
    this.inputConnections.push(this.fb.group({
      source: ['', Validators.required],
      target: ['', Validators.required],
      rule: ['all_to_all'],
      synapse_model: ['', Validators.required],
      params: this.fb.group({}),
    }));
  }
  removeInputConnection(index: number) { this.inputConnections.removeAt(index); }

  onConnectionSynapseChange(index: number) {
    const selectedModelId = this.inputConnections.at(index).get('synapse_model')?.value;
    const paramsGroup = this.getConnectionParamsGroup(index);
    const savedIn = paramsGroup.get('indegree')?.value;
    const savedOut = paramsGroup.get('outdegree')?.value;
    Object.keys(paramsGroup.controls).forEach(k => paramsGroup.removeControl(k));
    if (savedIn) paramsGroup.addControl('indegree', new FormControl(savedIn, Validators.required));
    if (savedOut) paramsGroup.addControl('outdegree', new FormControl(savedOut, Validators.required));
    const model = this.availableModules().flatMap(m => m.synapses).find(s => s.id === selectedModelId);
    if (model?.default_params) {
      Object.entries(model.default_params).forEach(([key, value]) =>
        paramsGroup.addControl(key, new FormControl(value, Validators.required)));
    }
  }

  onInputRuleChange(index: number) {
    const rule = this.inputConnections.at(index).get('rule')?.value;
    const paramsGroup = this.getConnectionParamsGroup(index);
    paramsGroup.removeControl('indegree');
    paramsGroup.removeControl('outdegree');
    if (rule === 'fixed_indegree') paramsGroup.addControl('indegree', new FormControl(100, Validators.required));
    if (rule === 'fixed_outdegree') paramsGroup.addControl('outdegree', new FormControl(100, Validators.required));
  }

  addRaceModelPopulation() {
    this.raceModelPopulations.push(new FormControl('', Validators.required));
  }

  addDifferentialPlot() {
    this.differentialPlots.push(this.fb.group({
      pop_a: ['', Validators.required],
      pop_b: ['', Validators.required],
      label: ['Decisione', Validators.required],
    }));
  }
  removeDifferentialPlot(index: number) { this.differentialPlots.removeAt(index); }

  onFileSelected(event: any) {
    if (event.target.files[0]) {
      this.selectedFile = event.target.files[0];
      this.selectedFileName.set(event.target.files[0].name);
    }
  }

  private parseAdvancedParams(itemsArray: any[]) {
    return itemsArray.map(item => {
      const p = { ...item };
      if (p.params) {
        Object.keys(p.params).forEach(k => {
          let val = p.params[k];
          if (typeof val === 'string') {
            val = val.trim();
            if (val.startsWith('{') || val.startsWith('[')) {
              try { p.params[k] = JSON.parse(val); } catch {}
            } else if (!isNaN(Number(val)) && val !== '') {
              p.params[k] = Number(val);
            }
          }
        });
      }
      return p;
    });
  }

  launch() {
    if (this.configForm.invalid || !this.networkId()) {
      this.configForm.markAllAsTouched();
      return;
    }
    this.jsonError.set(null);

    const formVal = this.configForm.value;
    let parsedExpParams: any = {};
    if (formVal.experiment_params?.trim()) {
      try {
        parsedExpParams = JSON.parse(formVal.experiment_params);
      } catch (e: any) {
        this.jsonError.set(e.message);
        return;
      }
    }

    // Built-in experiment mode: send a compact, self-describing payload.
    if (this.simulationMode() === 'experiment') {
      const builtinType = formVal.cc_builtin_type || 'decision_making';
      let experimentPayload: any;

      if (builtinType === 'cerebellum_conditioning') {
        experimentPayload = {
          ...parsedExpParams,
          builtin: 'cerebellum_conditioning',
          n_train: Number(formVal.cc_n_train ?? 20),
          n_test:  Number(formVal.cc_n_test  ?? 20),
          seed:    Number(formVal.cc_seed    ?? 1234),
        };
      } else if (builtinType === 'cerebellum_msi_race') {
        experimentPayload = parsedExpParams;
      } else {
        experimentPayload = {
          ...parsedExpParams,
          builtin: 'decision_making',
          decision_making: {
            modality: formVal.dm_modality,
            order: Number(formVal.dm_order),
            num_trials: Number(formVal.dm_num_trials),
            trial_slot_ms: 1000.0,
            threshold: Number(formVal.dm_threshold),
            rate: 30.0,
            number_of_neurons: 80,
            stimulus_window_ms: 600.0,
            bin_size_ms: 5.0,
            seed: Number(formVal.dm_seed),
          },
        };
      }
      this.currentStatus.set('PENDING');
      this.progress.set(0);
      this.simulationService
        .launchSimulation(this.networkId()!, experimentPayload, this.selectedFile || undefined)
        .subscribe({
          next: (response) => {
            this.activeSimulationId.set(response.simulation_id);
            this.startPolling(response.simulation_id);
          },
          error: (err) => {
            console.error('Launch failed', err);
            this.currentStatus.set('FAILED');
          },
        });
      return;
    }

    const finalPayload: any = {
      ...parsedExpParams,
      inputs: {
        devices: this.parseAdvancedParams(formVal.input_devices || []),
        connections: this.parseAdvancedParams(formVal.input_connections || []),
      },
      analysis: {
        differential_plots: formVal.differential_plots || [],
        response_cdf: {
          enabled: !!formVal.response_cdf_enabled,
          threshold: Number(formVal.response_cdf_threshold) || 15,
          bin_size: 5,
        },
      },
    };

    if (formVal.race_model_enabled) {
      finalPayload.analysis.race_model = {
        enabled: true,
        populations: formVal.race_model_populations || [],
      };
    }

    if (this.simulationMode() === 'continuous') {
      const phases: any = { test_duration_ms: formVal.test_duration_ms };
      if (formVal.has_training) {
        phases.train_duration_ms = formVal.train_duration_ms;
        phases.disable_plasticity_during_test = formVal.disable_plasticity_during_test;
      }
      finalPayload.phases = phases;
    } else {
      const itiMin = Number(formVal.protocol_iti_min_ms);
      const itiMax = Number(formVal.protocol_iti_max_ms);
      const stimDur = Number(formVal.protocol_stimulus_duration_ms);
      finalPayload.protocol = {
        num_trials: formVal.protocol_num_trials,
        trial_duration_ms: formVal.protocol_trial_duration_ms,
        ...(stimDur > 0 ? { stimulus_duration_ms: stimDur } : {}),
        ...(itiMin === itiMax
          ? { iti_ms: itiMin }
          : { iti_range_ms: [itiMin, itiMax], iti_ms: Math.round((itiMin + itiMax) / 2) }),
        stimuli_pool: (formVal.protocol_stimuli_pool || []).map((pool: any) => ({
          devices: pool.devices || [],
          weight: Number(pool.weight),
          condition_label: (pool.condition_label || '').toUpperCase(),
        })),
      };
    }

    this.currentStatus.set('PENDING');
    this.progress.set(0);

    this.simulationService
      .launchSimulation(this.networkId()!, finalPayload, this.selectedFile || undefined)
      .subscribe({
        next: (response) => {
          this.activeSimulationId.set(response.simulation_id);
          this.startPolling(response.simulation_id);
        },
        error: (err) => {
          console.error('Launch failed', err);
          this.currentStatus.set('FAILED');
        },
      });
  }

  startPolling(simId: string) {
    this.pollingSub = this.simulationService
      .pollStatus(simId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (statusData: SimulationStatus) => {
          this.currentStatus.set(statusData.status);
          this.progress.set(statusData.progress);
          if (['COMPLETED', 'FAILED', 'ABORTED'].includes(statusData.status)) this.stopPolling();
        },
        error: () => {
          this.currentStatus.set('FAILED');
          this.stopPolling();
        },
      });
  }

  abort() {
    if (!this.activeSimulationId()) return;
    this.stopPolling();
    this.currentStatus.set('ABORTED');
    this.simulationService.abortSimulation(this.activeSimulationId()!).subscribe();
  }

  resetView() {
    this.currentStatus.set('IDLE');
    this.progress.set(0);
    this.activeSimulationId.set(null);
  }

  stopPolling() { this.pollingSub?.unsubscribe(); }
  ngOnDestroy() { this.stopPolling(); }
}
