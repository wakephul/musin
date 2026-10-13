import { HttpErrorResponse } from '@angular/common/http';

/** Messaggio leggibile da un errore dell'API (FastAPI: `detail` stringa o lista di errori di validazione). */
export function apiErrorMessage(error: unknown, fallback = 'Operazione non riuscita.'): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return 'Server non raggiungibile.';
  const detail = error.error?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.filter((part: unknown) => part !== 'body').join('.') : '';
        const message = String(item.msg).replace(/^Value error, /, '');
        return field ? `${field}: ${message}` : message;
      })
      .join(' · ');
  }
  return fallback;
}
