import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Ottimizzazione delle performance con i Signals
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Configurazione Rotte
    provideRouter(routes),

    // Configurazione Client HTTP con il nostro Interceptor funzionale
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
