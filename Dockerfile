# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

FROM node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NITRO_PRESET=node-server
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY --from=builder /app/.output ./.output

EXPOSE 8080

CMD ["node", ".output/server/index.mjs"]
