# Stage 1: build di produzione
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

# Stage 2: file statici serviti da nginx (la configurazione arriva da docker-compose)
FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
