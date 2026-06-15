# Stage 1: Build dell'applicazione Angular 18
FROM node:20-alpine AS builder
WORKDIR /app

# Copia e installa le dipendenze
COPY package.json package-lock.json* ./

# [FIX] Sostituito 'npm ci' con 'npm install' per bypassare il disallineamento del lockfile
RUN npm install

# Copia il codice sorgente e lancia la build di produzione
COPY . .
RUN npm run build -- --configuration production

# Stage 2: Serve dell'applicazione tramite Nginx
FROM nginx:alpine

# Rimuove gli asset di default di Nginx
RUN rm -rf /usr/share/nginx/html/*

# Copia i file statici generati da Angular nello stage precedente
# Se il tuo angular.json differisce, adatta il path qui sotto
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]