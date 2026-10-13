// HttpErrorResponse arriva da un pacchetto Angular compilato in parte: fuori dal build serve il compilatore.
import '@angular/compiler';

import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { apiErrorMessage } from './errors';

const response = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('apiErrorMessage', () => {
  it('returns the detail string of the API', () => {
    expect(apiErrorMessage(response(400, { detail: 'Rete non trovata' }))).toBe('Rete non trovata');
  });

  it('joins validation errors, with the field when there is one', () => {
    const detail = [
      { loc: ['body', 'params', 'seed'], msg: 'Value error, deve essere positivo' },
      { loc: null, msg: 'richiesta non valida' },
    ];
    expect(apiErrorMessage(response(422, { detail }))).toBe('params.seed: deve essere positivo · richiesta non valida');
  });

  it('says when the server cannot be reached', () => {
    expect(apiErrorMessage(response(0, null))).toBe('Server non raggiungibile.');
  });

  it('falls back when there is nothing readable', () => {
    expect(apiErrorMessage(response(500, 'Internal Server Error'), 'Rete non salvata.')).toBe('Rete non salvata.');
    expect(apiErrorMessage(response(422, { detail: [] }))).toBe('Operazione non riuscita.');
    expect(apiErrorMessage(new Error('boom'), 'Rete non salvata.')).toBe('Rete non salvata.');
  });
});
