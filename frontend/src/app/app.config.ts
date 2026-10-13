import { ApplicationConfig, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

registerLocaleData(localeIt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    { provide: LOCALE_ID, useValue: 'it-IT' },
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
