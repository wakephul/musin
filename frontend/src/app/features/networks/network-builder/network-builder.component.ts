import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormArray,
  Validators,
} from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  NetworkService,
  NetworkModule,
} from '../../../core/services/network.service';
import { CytoscapeViewerComponent } from '../../../shared/components/cytoscape-viewer/cytoscape-viewer/cytoscape-viewer.component';
import { NETWORK_PRESETS, NetworkPreset } from '../../../core/data/presets';
import { countNeurons, countSynapses } from '../../../core/utils/topology';

@Component({
  selector: 'app-network-builder',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CytoscapeViewerComponent],
  template: `
    <div class="flex h-[calc(100vh-4rem)] bg-slate-50 overflow-hidden">
      <aside
        class="w-[450px] min-w-[450px] bg-white border-r border-slate-200 shadow-xl overflow-y-auto p-6 custom-scrollbar flex flex-col z-20"
      >
        <header class="mb-6 flex-shrink-0">
          <h1 class="text-2xl font-bold text-slate-800 tracking-tight">
            {{ editingId() ? 'Dettaglio / Modifica Rete' : 'Network Builder' }}
          </h1>
          <p class="text-slate-500 text-sm">
            {{ editingId() ? 'Modifica la rete o salvala come copia (fork)' : 'Definizione Strutturale e Biologica' }}
          </p>
        </header>

        @if (isLoadingModels()) {
          <div class="flex justify-center py-10">
            <svg
              class="animate-spin h-8 w-8 text-blue-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
        } @else {
          <form
            [formGroup]="networkForm"
            class="space-y-6 flex-1 flex flex-col"
          >
            <div class="space-y-6 flex-1">
              <!-- TEMPLATES: one-click validated networks -->
              <section
                class="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-100"
              >
                <div class="flex items-center gap-2 mb-3">
                  <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  <h2 class="text-xs font-bold text-blue-700 uppercase tracking-widest">
                    Start from a Template
                  </h2>
                </div>
                <div class="space-y-2">
                  @for (preset of networkPresets; track preset.key) {
                    <button type="button" (click)="loadNetworkPreset(preset)"
                      class="w-full text-left bg-white border border-blue-200 rounded-lg p-3 hover:border-blue-400 hover:shadow-sm transition-all group">
                      <div class="flex items-center justify-between">
                        <span class="text-sm font-bold text-slate-800 group-hover:text-blue-700">{{ preset.name }}</span>
                        <span class="text-[10px] font-bold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">Load →</span>
                      </div>
                      <p class="text-[11px] text-slate-500 mt-0.5">{{ preset.tagline }}</p>
                    </button>
                  }
                </div>
                <p class="text-[10px] text-slate-400 mt-2 italic">
                  Loads a validated circuit you can inspect and edit below before saving.
                </p>
              </section>

              <section
                class="bg-slate-50 p-4 rounded-xl border border-slate-100"
              >
                <h2
                  class="text-xs font-bold text-blue-600 uppercase tracking-widest mb-4"
                >
                  1. Dati Generali
                </h2>
                <div class="space-y-3">
                  <input
                    type="text"
                    formControlName="name"
                    placeholder="Nome della Rete"
                    class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                  />
                  <textarea
                    formControlName="description"
                    placeholder="Descrizione clinica..."
                    class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-16 resize-none text-sm"
                  ></textarea>
                </div>
              </section>

              <section
                class="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-inner"
              >
                <h2
                  class="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2"
                >
                  2. Costanti Biologiche (JSON)
                </h2>
                <textarea
                  formControlName="biological_params"
                  spellcheck="false"
                  class="w-full px-3 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none h-24 resize-y text-xs text-green-400 font-mono custom-scrollbar"
                ></textarea>
                @if (jsonError()) {
                  <p class="text-red-400 text-[10px] mt-2 font-bold">
                    {{ jsonError() }}
                  </p>
                }
              </section>

              <section>
                <div class="flex justify-between items-center mb-4">
                  <h2
                    class="text-xs font-bold text-slate-500 uppercase tracking-widest"
                  >
                    3. Popolazioni Biologiche
                  </h2>
                  <button
                    (click)="addPopulation()"
                    type="button"
                    class="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 font-semibold"
                  >
                    + Aggiungi
                  </button>
                </div>
                <div formArrayName="populations" class="space-y-3">
                  @for (pop of populations.controls; track $index) {
                    <div
                      [formGroupName]="$index"
                      class="p-3 bg-white border border-slate-200 rounded-xl shadow-sm relative group"
                    >
                      <button
                        (click)="removePopulation($index)"
                        class="absolute -top-2 -right-2 bg-red-100 text-red-600 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 z-10"
                      >
                        ✕
                      </button>
                      <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label
                            class="block text-[10px] font-bold text-slate-400 uppercase mb-1"
                            >ID Univoco</label
                          >
                          <input
                            type="text"
                            formControlName="id"
                            placeholder="GR"
                            class="w-full text-xs p-2 border rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </div>
                        <div>
                          <label
                            class="block text-[10px] font-bold text-slate-400 uppercase mb-1"
                            >Size</label
                          >
                          <input
                            type="number"
                            formControlName="size"
                            placeholder="200"
                            class="w-full text-xs p-2 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </div>
                        <div class="col-span-2">
                          <label
                            class="block text-[10px] font-bold text-slate-400 uppercase mb-1"
                            >Modello Neuronale</label
                          >
                          <select
                            formControlName="neuron_model"
                            (change)="onNeuronModelChange($index)"
                            class="w-full text-xs p-2 border rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white font-medium"
                          >
                            <option value="" disabled>
                              Seleziona un modello...
                            </option>
                            @if (isUnlistedNeuronModel(pop.get('neuron_model')?.value)) {
                              <option [value]="pop.get('neuron_model')?.value">
                                {{ pop.get('neuron_model')?.value }} (non in elenco)
                              </option>
                            }
                            @for (mod of availableModules(); track mod.id) {
                              <optgroup [label]="mod.label">
                                @for (n of mod.neurons; track n.id) {
                                  <option [value]="n.id">
                                    {{ n.label }} ({{ n.id }})
                                  </option>
                                }
                              </optgroup>
                            }
                          </select>
                        </div>

                        @if (pop.get('neuron_model')?.value) {
                          <div class="col-span-2 mt-1">
                            <label
                              class="block text-[10px] font-bold text-blue-400 uppercase mb-1 flex justify-between"
                            >
                              Parametri (JSON)
                            </label>
                            <textarea
                              formControlName="params"
                              spellcheck="false"
                              class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-y text-xs text-green-400 font-mono custom-scrollbar"
                              placeholder="{ ... }"
                            ></textarea>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              </section>

              <section>
                <div class="flex justify-between items-center mb-4">
                  <h2
                    class="text-xs font-bold text-slate-500 uppercase tracking-widest"
                  >
                    4. Proiezioni Biologiche
                  </h2>
                  <button
                    (click)="addProjection()"
                    type="button"
                    class="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700 font-semibold"
                  >
                    + Connetti
                  </button>
                </div>
                <div formArrayName="projections" class="space-y-3">
                  @for (proj of projections.controls; track $index) {
                    <div
                      [formGroupName]="$index"
                      class="p-3 bg-indigo-50/30 border border-slate-200 rounded-xl shadow-sm relative group"
                    >
                      <button
                        (click)="removeProjection($index)"
                        class="absolute -top-2 -right-2 bg-red-100 text-red-600 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 z-10"
                      >
                        ✕
                      </button>
                      <div class="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label
                            class="block text-[9px] font-bold text-slate-400 uppercase mb-1"
                            >Sorgente</label
                          >
                          <select
                            formControlName="source"
                            class="w-full text-xs p-1.5 border rounded font-mono uppercase bg-white"
                          >
                            <option value="" disabled>Seleziona</option>
                            @for (p of populations.value; track p.id) {
                              @if (p.id) {
                                <option [value]="p.id">{{ p.id }}</option>
                              }
                            }
                          </select>
                        </div>
                        <div>
                          <label
                            class="block text-[9px] font-bold text-slate-400 uppercase mb-1"
                            >Target</label
                          >
                          <select
                            formControlName="target"
                            class="w-full text-xs p-1.5 border rounded font-mono uppercase bg-white"
                          >
                            <option value="" disabled>Seleziona</option>
                            @for (p of populations.value; track p.id) {
                              @if (p.id) {
                                <option [value]="p.id">{{ p.id }}</option>
                              }
                            }
                          </select>
                        </div>
                        <div class="col-span-2">
                          <label
                            class="block text-[9px] font-bold text-slate-400 uppercase mb-1"
                            >Regola NEST</label
                          >
                          <select
                            formControlName="rule"
                            class="w-full text-xs p-1.5 border rounded bg-white"
                          >
                            <option value="all_to_all">all_to_all</option>
                            <option value="one_to_one">one_to_one</option>
                            <option value="fixed_indegree">
                              fixed_indegree
                            </option>
                            <option value="fixed_outdegree">
                              fixed_outdegree
                            </option>
                          </select>
                        </div>

                        @if (proj.get('rule')?.value === 'fixed_indegree') {
                          <div class="col-span-2">
                            <label
                              class="block text-[9px] font-bold text-slate-400 uppercase mb-1"
                              >Indegree (n. connessioni)</label
                            >
                            <input
                              type="number"
                              formControlName="indegree"
                              class="w-full text-xs p-1.5 border rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                          </div>
                        }
                        @if (proj.get('rule')?.value === 'fixed_outdegree') {
                          <div class="col-span-2">
                            <label
                              class="block text-[9px] font-bold text-slate-400 uppercase mb-1"
                              >Outdegree (n. connessioni)</label
                            >
                            <input
                              type="number"
                              formControlName="outdegree"
                              class="w-full text-xs p-1.5 border rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                          </div>
                        }

                        <div class="col-span-2 mt-1">
                          <label
                            class="block text-[9px] font-bold text-slate-400 uppercase mb-1"
                            >Modello Sinapsi</label
                          >
                          <select
                            formControlName="synapse_model"
                            (change)="onSynapseModelChange($index)"
                            class="w-full text-xs p-1.5 border rounded bg-white font-medium"
                          >
                            <option value="" disabled>
                              Seleziona una sinapsi...
                            </option>
                            @for (mod of availableModules(); track mod.id) {
                              <optgroup [label]="mod.label">
                                @for (s of mod.synapses; track s.id) {
                                  <option [value]="s.id">
                                    {{ s.label }} ({{ s.id }})
                                  </option>
                                }
                              </optgroup>
                            }
                          </select>
                        </div>

                        @if (proj.get('synapse_model')?.value) {
                          <div class="col-span-2 mt-1">
                            <label
                              class="block text-[10px] font-bold text-indigo-400 uppercase mb-1 flex justify-between"
                            >
                              Parametri Sinapsi (JSON)
                            </label>
                            <textarea
                              formControlName="params"
                              spellcheck="false"
                              class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-y text-xs text-green-400 font-mono custom-scrollbar"
                              placeholder="{ ... }"
                            ></textarea>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              </section>
            </div>

            <button
              (click)="submitNetwork()"
              [disabled]="networkForm.invalid || isSaving()"
              class="w-full mt-6 bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 disabled:opacity-50 shadow-lg"
            >
              {{
                isSaving() ? 'Salvataggio in corso...'
                  : editingId() ? 'SALVA MODIFICHE' : 'SALVA STRUTTURA RETE'
              }}
            </button>
            @if (editingId()) {
              <button
                (click)="saveAsCopyAndSubmit()"
                [disabled]="networkForm.invalid || isSaving()"
                class="w-full mt-3 bg-white border-2 border-blue-500 text-blue-700 font-bold py-3 rounded-xl hover:bg-blue-50 disabled:opacity-50"
              >
                SALVA COME COPIA (FORK)
              </button>
            }
          </form>
        }
      </aside>

      <main class="flex-1 relative bg-slate-200/50 p-6 z-10">
        <div
          class="h-full w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative"
        >
          <app-cytoscape-viewer [elements]="graphElements()" />
        </div>
      </main>
    </div>
  `,
})
export class NetworkBuilderComponent implements OnInit {
  private fb = inject(FormBuilder);
  private networkService = inject(NetworkService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  isLoadingModels = signal(true);
  availableModules = signal<NetworkModule[]>([]);
  isSaving = signal(false);
  // When set, the builder is editing an existing network (route networks/:id);
  // otherwise it is creating a new one (networks/new). "Salva come copia" always
  // creates a new network (fork) from the current form state.
  editingId = signal<string | null>(null);
  saveAsCopy = false;
  graphElements = signal<any[]>([]);
  jsonError = signal<string | null>(null);

  readonly networkPresets = NETWORK_PRESETS;

  defaultBioJson = `{\n  "LTP1": 0.001,\n  "LTD1": 0.02,\n  "Init_PFPC": 4.0\n}`;

  networkForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    description: [''],
    biological_params: [this.defaultBioJson],
    populations: this.fb.array([]),
    projections: this.fb.array([]),
  });

  get populations() {
    return this.networkForm.get('populations') as FormArray;
  }
  get projections() {
    return this.networkForm.get('projections') as FormArray;
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') this.editingId.set(id);

    this.networkService.getModels().subscribe({
      next: (modules) => {
        this.availableModules.set(modules);
        this.isLoadingModels.set(false);
        if (this.editingId()) {
          this.loadExistingNetwork(this.editingId()!);
        } else if (this.populations.length === 0) {
          this.addPopulation();
        }
      },
      error: () => {
        this.jsonError.set('Impossibile caricare i modelli da NEST. Verifica che il backend sia attivo.');
        this.isLoadingModels.set(false);
      },
    });

    this.networkForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => this.updateGraph(val));
  }

  /** Load an existing saved network into the form (edit / fork). */
  private loadExistingNetwork(id: string) {
    this.networkService.getNetworkById(id).subscribe({
      next: (net: any) => {
        const def = net.definition ?? {};
        const topo = def.topology ?? {};
        const asStr = (p: any) => (typeof p === 'string' ? p : JSON.stringify(p ?? {}, null, 2));
        this.populations.clear();
        this.projections.clear();
        this.networkForm.patchValue({
          name: net.name ?? '',
          description: net.description ?? '',
          biological_params: asStr(def.params ?? {}),
        });
        (topo.populations ?? []).forEach((pop: any) => {
          this.populations.push(this.fb.group({
            id: [pop.id, Validators.required],
            size: [pop.size, [Validators.required, Validators.min(1)]],
            neuron_model: [pop.neuron_model, Validators.required],
            params: [asStr(pop.params)],
          }));
        });
        (topo.projections ?? []).forEach((proj: any) => {
          // indegree/outdegree sono salvati dentro params: li spostiamo nei campi
          // dedicati, così c'è un solo punto in cui modificarli.
          const { indegree, outdegree, ...params } = proj.params ?? {};
          this.projections.push(this.fb.group({
            source: [proj.source, Validators.required],
            target: [proj.target, Validators.required],
            rule: [proj.rule, Validators.required],
            indegree: [indegree ?? 100],
            outdegree: [outdegree ?? 100],
            synapse_model: [proj.synapse_model ?? 'static_synapse', Validators.required],
            params: [asStr(params)],
          }));
        });
        if (this.populations.length === 0) this.addPopulation();
        this.updateGraph(this.networkForm.value);
      },
      error: () => this.jsonError.set('Impossibile caricare la rete richiesta.'),
    });
  }

  /** One-click load of a validated network template into the builder form. */
  loadNetworkPreset(preset: NetworkPreset) {
    this.populations.clear();
    this.projections.clear();

    this.networkForm.patchValue({
      name: preset.name,
      description: preset.description,
      biological_params: preset.biological_params,
    });

    preset.populations.forEach((pop) => {
      this.populations.push(
        this.fb.group({
          id: [pop.id, Validators.required],
          size: [pop.size, [Validators.required, Validators.min(1)]],
          neuron_model: [pop.neuron_model, Validators.required],
          params: [pop.params],
        }),
      );
    });

    preset.projections.forEach((proj) => {
      this.projections.push(
        this.fb.group({
          source: [proj.source, Validators.required],
          target: [proj.target, Validators.required],
          rule: [proj.rule, Validators.required],
          indegree: [proj.indegree ?? 100],
          outdegree: [proj.outdegree ?? 100],
          synapse_model: [proj.synapse_model, Validators.required],
          params: [proj.params],
        }),
      );
    });
  }

  addPopulation() {
    this.populations.push(
      this.fb.group({
        id: ['', Validators.required],
        size: [100, [Validators.required, Validators.min(1)]],
        neuron_model: ['', Validators.required],
        params: ['{\n  \n}'], // Stringa JSON grezza per il textarea
      }),
    );
  }
  removePopulation(index: number) {
    this.populations.removeAt(index);
  }

  addProjection() {
    this.projections.push(
      this.fb.group({
        source: ['', Validators.required],
        target: ['', Validators.required],
        rule: ['all_to_all', Validators.required],
        indegree: [100],
        outdegree: [100],
        synapse_model: ['', Validators.required],
        params: ['{\n  \n}'], // Stringa JSON grezza per il textarea
      }),
    );
  }
  removeProjection(index: number) {
    this.projections.removeAt(index);
  }

  isUnlistedNeuronModel(modelId: string | null | undefined): boolean {
    if (!modelId) return false;
    return !this.availableModules().some((m) => m.neurons.some((n: any) => n.id === modelId));
  }

  onNeuronModelChange(index: number) {
    const selectedModelId = this.populations
      .at(index)
      .get('neuron_model')?.value;
    const model = this.availableModules()
      .flatMap((m) => m.neurons)
      .find((n) => n.id === selectedModelId);

    // Autocompila il textarea con i parametri di default come JSON bello formattato
    if (
      model &&
      model.default_params &&
      Object.keys(model.default_params).length > 0
    ) {
      this.populations
        .at(index)
        .get('params')
        ?.setValue(JSON.stringify(model.default_params, null, 2));
    } else {
      this.populations.at(index).get('params')?.setValue('{\n  \n}');
    }
  }

  onSynapseModelChange(index: number) {
    const selectedModelId = this.projections
      .at(index)
      .get('synapse_model')?.value;
    const model = this.availableModules()
      .flatMap((m) => m.synapses)
      .find((s) => s.id === selectedModelId);

    if (
      model &&
      model.default_params &&
      Object.keys(model.default_params).length > 0
    ) {
      this.projections
        .at(index)
        .get('params')
        ?.setValue(JSON.stringify(model.default_params, null, 2));
    } else {
      this.projections.at(index).get('params')?.setValue('{\n  \n}');
    }
  }

  private updateGraph(val: any) {
    const nodes = (val.populations || [])
      .filter((p: any) => p.id)
      .map((p: any) => ({
        data: {
          id: p.id,
          label: `${p.id}\nN=${p.size}`,
          size: Number(p.size) || 100,
        },
      }));
    const edges = (val.projections || [])
      .filter((pr: any) => pr.source && pr.target)
      .map((pr: any, i: number) => ({
        data: {
          id: `edge_${i}`,
          source: pr.source,
          target: pr.target,
          label: `[${pr.rule}]\n${pr.synapse_model || '?'}`,
        },
      }));
    this.graphElements.set([...nodes, ...edges]);
  }

  private parseAdvancedParams(itemsArray: any[], context: string) {
    return itemsArray.map((item) => {
      const p = { ...item };

      // Valida e trasforma la stringa testuale in un Oggetto JSON reale
      if (typeof p.params === 'string' && p.params.trim() !== '') {
        try {
          p.params = JSON.parse(p.params);
        } catch (e: any) {
          throw new Error(
            `Syntax Error nel JSON di ${context} (${p.id || p.source || 'Sconosciuto'}): ${e.message}`,
          );
        }
      } else {
        p.params = {};
      }

      // Il backend e il worker leggono indegree/outdegree da params.
      delete p.params.indegree;
      delete p.params.outdegree;
      if (p.rule === 'fixed_indegree') p.params.indegree = Number(p.indegree);
      if (p.rule === 'fixed_outdegree') p.params.outdegree = Number(p.outdegree);
      delete p.indegree;
      delete p.outdegree;

      return p;
    });
  }

  submitNetwork() {
    // Capture & clear the fork flag first so an early validation return can't
    // leave it stuck for the next save.
    const asCopy = this.saveAsCopy;
    this.saveAsCopy = false;
    if (this.networkForm.invalid) return;
    this.jsonError.set(null);
    this.isSaving.set(true);

    const formVal = this.networkForm.value;
    let parsedBioParams = {};

    if (formVal.biological_params && formVal.biological_params.trim() !== '') {
      try {
        parsedBioParams = JSON.parse(formVal.biological_params);
      } catch (e: any) {
        this.jsonError.set(`Errore nelle Costanti Biologiche: ${e.message}`);
        this.isSaving.set(false);
        return;
      }
    }

    let parsedPopulations = [];
    let parsedProjections = [];

    // Catturiamo gli errori di sintassi nei box testuali tramite il Try-Catch del nostro parser
    try {
      parsedPopulations = this.parseAdvancedParams(
        formVal.populations || [],
        'una Popolazione',
      );
      parsedProjections = this.parseAdvancedParams(
        formVal.projections || [],
        'una Proiezione',
      );
    } catch (e: any) {
      this.jsonError.set(e.message);
      this.isSaving.set(false);
      return;
    }

    const editId = this.editingId();

    const payload = {
      name: asCopy ? `${formVal.name ?? 'Rete Biologica'} (copia)` : (formVal.name ?? 'Rete Biologica'),
      description: formVal.description ?? '',
      nodes_count: countNeurons(parsedPopulations),
      edges_count: countSynapses(parsedPopulations, parsedProjections),
      params: parsedBioParams,
      topology: {
        populations: parsedPopulations,
        projections: parsedProjections,
      },
    };

    // Edit in place (PUT) only when editing AND not forking; otherwise create new.
    const request$ = (editId && !asCopy)
      ? this.networkService.updateNetwork(editId, payload)
      : this.networkService.createNetwork(payload);

    request$.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.jsonError.set(`Errore del Server: ${err.message || 'salvataggio non riuscito'}`);
      },
    });
  }

  /** "Salva come copia" — fork the current form state into a NEW network. */
  saveAsCopyAndSubmit() {
    this.saveAsCopy = true;
    this.submitNetwork();
  }
}
