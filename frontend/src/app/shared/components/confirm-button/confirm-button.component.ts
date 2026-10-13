import { Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';

/**
 * Pulsante per azioni distruttive: il primo clic chiede conferma sul posto,
 * il secondo (su `confirmLabel`) emette `confirmed`.
 * `armed` è leggibile da fuori (`#ref` nel template) per nascondere le altre
 * azioni della riga mentre la conferma è aperta.
 * Con `needsConfirm` falso il primo clic emette subito: serve quando la stessa
 * azione è distruttiva solo in certi stati (non c'è niente da sostituire).
 */
@Component({
  selector: 'app-confirm-button',
  standalone: true,
  template: `
    @if (armed()) {
      <span class="inline-flex flex-col items-end gap-1 align-middle">
        <span class="inline-flex gap-1">
          <button type="button" class="btn btn-danger btn-sm" [disabled]="disabled()" (click)="confirm()">
            {{ confirmLabel() }}
          </button>
          <button #cancelButton type="button" class="btn btn-quiet btn-sm" (click)="close()">Annulla</button>
        </span>
        @if (hint()) {
          <span class="max-w-[15rem] whitespace-normal text-right text-xs text-muted" role="status">{{ hint() }}</span>
        }
      </span>
    } @else {
      <button #trigger type="button" [class]="triggerClass()" [disabled]="disabled()" (click)="start()">
        {{ label() }}
      </button>
    }
  `,
})
export class ConfirmButtonComponent {
  readonly label = input('Elimina');
  readonly confirmLabel = input('Conferma eliminazione');
  readonly hint = input<string>();
  readonly disabled = input(false);
  readonly needsConfirm = input(true);
  readonly triggerClass = input('btn btn-quiet btn-sm');
  readonly confirmed = output<void>();

  readonly armed = signal(false);

  private cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private refocusTrigger = false;

  constructor() {
    // Il pulsante cliccato sparisce dal DOM: senza questo chi usa la tastiera perde il fuoco.
    // Il fuoco va su Annulla, così un Invio tenuto premuto non conferma l'eliminazione.
    effect(() => this.cancelButton()?.nativeElement.focus());
    effect(() => {
      const trigger = this.trigger();
      if (trigger && this.refocusTrigger) {
        this.refocusTrigger = false;
        trigger.nativeElement.focus();
      }
    });
  }

  protected start(): void {
    if (this.needsConfirm()) this.armed.set(true);
    else this.confirmed.emit();
  }

  protected confirm(): void {
    this.close();
    this.confirmed.emit();
  }

  protected close(): void {
    this.refocusTrigger = true;
    this.armed.set(false);
  }
}
