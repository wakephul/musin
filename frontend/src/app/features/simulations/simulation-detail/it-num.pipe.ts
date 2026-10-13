import { Pipe, PipeTransform } from '@angular/core';

import { formatNumber } from './results-helpers';

/** `{{ valore | itNum: 1 }}`: numero it-IT con un decimale (virgola). Senza argomenti, intero. */
@Pipe({ name: 'itNum', standalone: true })
export class ItNumPipe implements PipeTransform {
  transform(value: unknown, digits = 0, minDigits = digits): string {
    return formatNumber(value, digits, minDigits);
  }
}
