import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Stimulus } from '../../core/models';
import { StimulusService } from '../../core/services/stimulus.service';
import { apiErrorMessage } from '../../core/utils/errors';
import { ConfirmButtonComponent } from '../../shared/components/confirm-button/confirm-button.component';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const INTEGER = new Intl.NumberFormat('it-IT');
const DECIMAL = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

// Gli esempi stanno qui perché le graffe nel testo di un template Angular vanno evitate.
const FORMATS = [
  {
    title: 'JSON con un elenco di tempi per treno',
    note: 'Chiave spike_trains: una lista di tempi per ogni treno.',
    example: '{"spike_trains": [[12.5, 40.1],\n                  [8.0]]}',
  },
  {
    title: 'JSON con eventi di uno spike recorder',
    note: 'Come un blocco di popolazione del file "spikes.json" esportato da una simulazione.',
    example: '{"senders": [1, 1, 2],\n "times": [12.5, 40.1, 8.0]}',
  },
  {
    title: 'CSV',
    note: 'Colonne sender,time, una riga per spike. La riga di intestazione è facoltativa.',
    example: 'sender,time\n1,12.5',
  },
  {
    title: 'HDF5 (.h5, .hdf5)',
    note: 'Due dataset numerici della stessa lunghezza, senders e times.',
    example: 'senders  [1, 1, 2]\ntimes    [12.5, 40.1, 8.0]',
  },
];

function format(value: number | null | undefined, formatter: Intl.NumberFormat, unit = ''): string {
  return value == null ? 'n/d' : formatter.format(value) + unit;
}

@Component({
  selector: 'app-stimuli',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, ConfirmButtonComponent],
  template: `
    <div class="page space-y-6">
      <h1 class="page-title">Stimoli</h1>

      <section class="panel" aria-labelledby="upload-title">
        <div class="panel-header">
          <h2 id="upload-title" class="section-title">Carica uno stimolo</h2>
        </div>
        <form class="panel-body" [formGroup]="form" (ngSubmit)="submit()">
          <div class="grid gap-4 md:grid-cols-3">
            <div>
              <label class="label" for="stimulus-name">Nome</label>
              <input id="stimulus-name" type="text" class="input" formControlName="name" maxlength="255" autocomplete="off" />
            </div>
            <div>
              <label class="label" for="stimulus-description">Descrizione (facoltativa)</label>
              <input id="stimulus-description" type="text" class="input" formControlName="description" autocomplete="off" />
            </div>
            <div>
              <label class="label" for="stimulus-file">File</label>
              <input
                #fileInput
                id="stimulus-file"
                type="file"
                class="input file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-2 file:py-0.5 file:text-xs file:text-ink"
                accept=".json,.csv,.h5,.hdf5"
                [attr.aria-describedby]="fileError() ? 'stimulus-file-error' : 'stimulus-file-help'"
                (change)="selectFile($event)"
              />
              @if (fileError()) {
                <p id="stimulus-file-error" class="field-error" role="alert">{{ fileError() }}</p>
              } @else {
                <p id="stimulus-file-help" class="help">.json, .csv, .h5 o .hdf5, massimo 20 MB.</p>
              }
            </div>
          </div>
          @if (uploadError()) {
            <p class="notice notice-error mt-4" role="alert">{{ uploadError() }}</p>
          }
          <button type="submit" class="btn btn-primary mt-4" [disabled]="form.invalid || !file() || !!fileError() || uploading()">
            {{ uploading() ? 'Caricamento in corso…' : 'Carica stimolo' }}
          </button>

          <details class="mt-4 border-t border-line pt-3">
            <summary class="cursor-pointer text-sm text-muted hover:text-ink">Formati accettati</summary>
            <p class="mt-3 text-sm">
              Tempi in millisecondi, arrotondati a 0,1 ms; i tempi minori o uguali a 0 vengono scartati. Nei formati a eventi
              ogni sender distinto diventa un treno. Al massimo 5000 treni e 20 MB per file.
            </p>
            <div class="mt-3 grid gap-4 md:grid-cols-2">
              @for (item of formats; track item.title) {
                <div>
                  <h3 class="text-sm font-medium">{{ item.title }}</h3>
                  <p class="help mb-1.5">{{ item.note }}</p>
                  <pre class="code-block">{{ item.example }}</pre>
                </div>
              }
            </div>
          </details>
        </form>
      </section>

      <section class="panel" aria-labelledby="list-title">
        <div class="panel-header">
          <h2 id="list-title" class="section-title">Stimoli caricati</h2>
        </div>
        @if (listError()) {
          <p class="notice notice-error m-4" role="alert">{{ listError() }}</p>
        }
        @if (stimuli()) {
          @if (rows().length) {
            <div class="overflow-x-auto">
              <table class="table-list">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col" class="!text-right">Treni</th>
                    <th scope="col" class="!text-right">Spike</th>
                    <th scope="col" class="!text-right">Durata</th>
                    <th scope="col" class="whitespace-nowrap">File di origine</th>
                    <th scope="col" class="hidden whitespace-nowrap lg:table-cell">Caricato il</th>
                    <th scope="col"><span class="sr-only">Azioni</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.stimulus.id) {
                    <tr>
                      <!-- w-full + max-w-0: la colonna prende lo spazio che resta e tronca invece di allargare la tabella -->
                      <td class="w-full max-w-0">
                        <div class="font-medium">{{ row.stimulus.name }}</div>
                        @if (row.stimulus.description) {
                          <div class="truncate text-xs text-muted" [title]="row.stimulus.description">
                            {{ row.stimulus.description }}
                          </div>
                        }
                      </td>
                      <td class="num text-right">{{ row.trains }}</td>
                      <td class="num text-right">{{ row.spikes }}</td>
                      <td class="num whitespace-nowrap text-right">{{ row.duration }}</td>
                      <td class="num max-w-[14rem] truncate text-xs" [title]="row.source">{{ row.source }}</td>
                      <td class="num hidden whitespace-nowrap text-muted lg:table-cell">
                        {{ row.stimulus.created_at | date: 'dd/MM/yyyy HH:mm' }}
                      </td>
                      <td class="whitespace-nowrap text-right">
                        <app-confirm-button [disabled]="deletingId() === row.stimulus.id" (confirmed)="delete(row.stimulus)" />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="empty">
              Nessuno stimolo caricato: uno stimolo è un insieme di treni di spike registrati che una simulazione riproduce con un
              dispositivo di ingresso "Treni di spike da file".
            </p>
          }
        } @else if (!listError()) {
          <p class="empty">Caricamento…</p>
        }
      </section>
    </div>
  `,
})
export class StimuliComponent {
  private stimulusService = inject(StimulusService);
  private fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly formats = FORMATS;
  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    description: [''],
  });
  protected file = signal<File | null>(null);
  protected fileError = computed(() => ((this.file()?.size ?? 0) > MAX_FILE_BYTES ? 'File troppo grande (massimo 20 MB).' : null));
  protected uploading = signal(false);
  protected uploadError = signal<string | null>(null);

  /** `null` finché il primo caricamento non è arrivato. */
  protected stimuli = signal<Stimulus[] | null>(null);
  protected listError = signal<string | null>(null);
  protected deletingId = signal<number | null>(null);
  protected rows = computed(() =>
    (this.stimuli() ?? []).map((stimulus) => ({
      stimulus,
      trains: format(stimulus.definition?.n_trains, INTEGER),
      spikes: format(stimulus.definition?.n_spikes, INTEGER),
      duration: format(stimulus.definition?.duration_ms, DECIMAL, ' ms'),
      source: stimulus.definition?.source_filename ?? 'n/d',
    })),
  );

  constructor() {
    this.load();
  }

  protected selectFile(event: Event): void {
    this.file.set((event.target as HTMLInputElement).files?.[0] ?? null);
    this.uploadError.set(null);
  }

  protected submit(): void {
    const file = this.file();
    if (this.form.invalid || !file || this.fileError()) return;
    const { name, description } = this.form.getRawValue();
    this.uploading.set(true);
    this.uploadError.set(null);
    this.stimulusService.uploadStimulus(name.trim(), file, description.trim() || undefined).subscribe({
      next: () => {
        this.form.reset();
        this.fileInput().nativeElement.value = '';
        this.file.set(null);
        this.uploading.set(false);
        this.load();
      },
      error: (err) => {
        this.uploadError.set(apiErrorMessage(err, 'Stimolo non caricato.'));
        this.uploading.set(false);
      },
    });
  }

  protected delete(stimulus: Stimulus): void {
    this.deletingId.set(stimulus.id);
    this.stimulusService.deleteStimulus(stimulus.id).subscribe({
      next: () => this.load(),
      error: (err) => this.listFailed(err, 'Stimolo non eliminato.'),
    });
  }

  private load(): void {
    this.stimulusService.getStimuli().subscribe({
      next: (stimuli) => {
        this.stimuli.set(stimuli);
        this.listError.set(null);
        this.deletingId.set(null);
      },
      error: (err) => this.listFailed(err, 'Elenco degli stimoli non caricato.'),
    });
  }

  private listFailed(err: unknown, fallback: string): void {
    this.listError.set(apiErrorMessage(err, fallback));
    this.deletingId.set(null);
  }
}
