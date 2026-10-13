import { JsonPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ConnectionRule, ModelCatalogue, Population, Stimulus } from '../../../core/models';
import {
  CONNECTION_RULES,
  ConnectionDraft,
  DeviceDraft,
  InputsDraft,
  RULE_PARAMS,
  STATIC_SYNAPSE,
  setConnectionRule,
} from './experiment-params';
import { CONNECTION_PARAM_META, DEVICE_PARAM_META, FieldMeta, metaFor } from './experiment-validation';
import { ParamFieldComponent } from './param-field.component';

/** Dispositivi di stimolo e loro connessioni verso le popolazioni della rete. */
@Component({
  selector: 'app-inputs-editor',
  standalone: true,
  imports: [FormsModule, RouterLink, JsonPipe, ParamFieldComponent],
  host: { class: 'block space-y-5' },
  template: `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="section-title">Dispositivi di stimolo</h2>
          <p class="help">{{ hint() }}</p>
        </div>
        <button type="button" class="btn btn-sm" [disabled]="!models().length" (click)="addDevice()">
          Aggiungi dispositivo
        </button>
      </div>
      @if (catalogue() === null) {
        <p class="notice notice-error m-4" role="alert">
          Elenco dei modelli di stimolo non disponibile. Ricarica la pagina.
        </p>
      }
      @for (device of inputs().devices; track device; let i = $index) {
        <div class="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
          <div class="w-36">
            <label class="label" [for]="'device-' + i + '-id'">Identificatore</label>
            <input
              type="text"
              class="input num"
              [id]="'device-' + i + '-id'"
              [(ngModel)]="device.id"
              placeholder="es. VIS"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
            />
          </div>
          <div class="w-64">
            <label class="label" [for]="'device-' + i + '-model'">Modello</label>
            <select
              class="input"
              [id]="'device-' + i + '-model'"
              [ngModel]="device.model"
              (ngModelChange)="setModel(device, $event)"
            >
              @for (model of models(); track model.id) {
                <option [value]="model.id">{{ model.label }}</option>
              }
              @if (device.model && !isCatalogued(device.model)) {
                <option [value]="device.model">{{ device.model }}</option>
              }
            </select>
            @if (description(device.model); as text) {
              <p class="help">{{ text }}</p>
            }
          </div>
          @for (key of keys(device.params); track key) {
            @if (key === 'stimulus_id') {
              <div class="w-72">
                <label class="label" [for]="'device-' + i + '-stimulus'">Stimolo</label>
                <select class="input" [id]="'device-' + i + '-stimulus'" [(ngModel)]="device.params[key]">
                  <option [ngValue]="null" disabled>Scegli uno stimolo</option>
                  @for (stimulus of stimuli() ?? []; track stimulus.id) {
                    <option [ngValue]="stimulus.id">{{ stimulusLabel(stimulus) }}</option>
                  }
                </select>
                @if (stimuli() === null) {
                  <p class="field-error">Libreria degli stimoli non disponibile. Ricarica la pagina.</p>
                } @else if (stimuli()?.length === 0) {
                  <p class="help">
                    La libreria è vuota: <a routerLink="/stimuli">carica un file di treni di spike</a>.
                  </p>
                }
              </div>
            } @else if (isNumeric(device.params[key])) {
              <app-param-field
                class="w-32"
                [fieldId]="'device-' + i + '-' + key"
                [meta]="deviceMeta(key)"
                [(value)]="device.params[key]"
              />
            } @else {
              <span class="tag mt-5">{{ key }} = {{ device.params[key] | json }}</span>
            }
          }
          <button type="button" class="btn btn-quiet btn-sm ml-auto mt-5" (click)="removeDevice(device)">Rimuovi</button>
        </div>
      } @empty {
        <p class="empty">Nessun dispositivo. Senza stimoli la rete produce solo attività spontanea.</p>
      }
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="section-title">Connessioni dei dispositivi</h2>
          <p class="help">
            Ogni connessione porta un dispositivo su una popolazione della rete con sinapsi
            <span class="num">{{ staticSynapse }}</span
            >.
          </p>
        </div>
        <button type="button" class="btn btn-sm" [disabled]="!inputs().devices.length" (click)="addConnection()">
          Aggiungi connessione
        </button>
      </div>
      @for (connection of inputs().connections; track connection; let i = $index) {
        <div class="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
          <div class="w-40">
            <label class="label" [for]="'connection-' + i + '-source'">Dispositivo</label>
            <select class="input num" [id]="'connection-' + i + '-source'" [(ngModel)]="connection.device">
              <option [ngValue]="null" disabled>Scegli</option>
              @for (device of inputs().devices; track device) {
                <option [ngValue]="device">{{ device.id || 'senza identificatore' }}</option>
              }
            </select>
          </div>
          <div class="w-40">
            <label class="label" [for]="'connection-' + i + '-target'">Popolazione</label>
            <select class="input num" [id]="'connection-' + i + '-target'" [(ngModel)]="connection.target">
              <option value="" disabled>Scegli</option>
              @for (population of populations(); track population.id) {
                <option [value]="population.id">{{ population.id }}</option>
              }
              @if (connection.target && !hasPopulation(connection.target)) {
                <option [value]="connection.target">{{ connection.target }} (non nella rete)</option>
              }
            </select>
          </div>
          <div class="w-48">
            <label class="label" [for]="'connection-' + i + '-rule'">Regola</label>
            <select
              class="input num"
              [id]="'connection-' + i + '-rule'"
              [ngModel]="connection.rule"
              (ngModelChange)="setRule(connection, $event)"
            >
              @for (rule of rules; track rule) {
                <option [value]="rule">{{ rule }}</option>
              }
            </select>
          </div>
          @for (key of connectionKeys(connection); track key) {
            <app-param-field
              class="w-28"
              [fieldId]="'connection-' + i + '-' + key"
              [meta]="connectionMeta[key]"
              [(value)]="connection.params[key]"
            />
          }
          @if (connection.synapse_model !== staticSynapse) {
            <span class="tag mt-5">{{ connection.synapse_model }}</span>
          }
          @for (key of extraKeys(connection); track key) {
            <span class="tag mt-5">{{ key }} = {{ connection.params[key] | json }}</span>
          }
          <button type="button" class="btn btn-quiet btn-sm ml-auto mt-5" (click)="removeConnection(connection)">
            Rimuovi
          </button>
        </div>
      } @empty {
        <p class="empty">
          @if (inputs().devices.length) {
            Nessuna connessione: i dispositivi non raggiungono la rete.
          } @else {
            Aggiungi prima un dispositivo.
          }
        </p>
      }
    </section>
  `,
})
export class InputsEditorComponent {
  /** Bozza di dispositivi e connessioni, modificata sul posto. */
  readonly inputs = input.required<InputsDraft>();
  readonly populations = input.required<Population[]>();
  /** undefined durante il caricamento, null se il caricamento è fallito. */
  readonly catalogue = input.required<ModelCatalogue | null | undefined>();
  readonly stimuli = input.required<Stimulus[] | null | undefined>();
  readonly hint = input.required<string>();

  protected readonly rules = CONNECTION_RULES;
  protected readonly staticSynapse = STATIC_SYNAPSE;
  protected readonly connectionMeta = CONNECTION_PARAM_META;

  protected models = computed(() => this.catalogue()?.stimulus_devices ?? []);
  private synapseDefaults = computed(
    () =>
      this.catalogue()
        ?.modules.flatMap((module) => module.synapses)
        .find((synapse) => synapse.id === STATIC_SYNAPSE)?.default_params ?? { weight: 1, delay: 1 },
  );

  protected keys(params: Record<string, unknown>): string[] {
    return Object.keys(params);
  }

  protected isNumeric(value: unknown): boolean {
    return value === null || typeof value === 'number';
  }

  protected deviceMeta(key: string): FieldMeta {
    return metaFor(DEVICE_PARAM_META, key);
  }

  protected isCatalogued(modelId: string): boolean {
    return this.models().some((model) => model.id === modelId);
  }

  protected hasPopulation(id: string): boolean {
    return this.populations().some((population) => population.id === id);
  }

  protected description(modelId: string): string | undefined {
    return this.models().find((model) => model.id === modelId)?.description;
  }

  protected stimulusLabel(stimulus: Stimulus): string {
    const definition = stimulus.definition;
    return definition ? `${stimulus.name} · ${definition.n_trains} treni · ${definition.duration_ms} ms` : stimulus.name;
  }

  /** Parametro della regola, peso e ritardo: i campi modificabili di una connessione. */
  protected connectionKeys(connection: ConnectionDraft): string[] {
    const ruleParam = RULE_PARAMS[connection.rule];
    return [...(ruleParam ? [ruleParam.key] : []), 'weight', 'delay'];
  }

  /** Altri parametri arrivati da una simulazione precedente: restano nel payload e si vedono qui. */
  protected extraKeys(connection: ConnectionDraft): string[] {
    return Object.keys(connection.params).filter((key) => !(key in CONNECTION_PARAM_META));
  }

  protected addDevice(): void {
    const model = this.models()[0];
    this.inputs().devices.push({ id: '', model: model.id, params: { ...model.default_params } });
  }

  protected setModel(device: DeviceDraft, modelId: string): void {
    device.model = modelId;
    device.params = { ...this.models().find((model) => model.id === modelId)?.default_params };
  }

  protected removeDevice(device: DeviceDraft): void {
    const inputs = this.inputs();
    inputs.devices = inputs.devices.filter((item) => item !== device);
    inputs.connections = inputs.connections.filter((connection) => connection.device !== device);
  }

  protected addConnection(): void {
    const devices = this.inputs().devices;
    this.inputs().connections.push({
      device: devices[devices.length - 1] ?? null,
      target: '',
      rule: 'all_to_all',
      synapse_model: STATIC_SYNAPSE,
      params: { ...this.synapseDefaults() },
    });
  }

  protected setRule(connection: ConnectionDraft, rule: ConnectionRule): void {
    setConnectionRule(connection, rule);
  }

  protected removeConnection(connection: ConnectionDraft): void {
    const inputs = this.inputs();
    inputs.connections = inputs.connections.filter((item) => item !== connection);
  }
}
