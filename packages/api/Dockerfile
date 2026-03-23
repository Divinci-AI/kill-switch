FROM node:22-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc

# Production stage
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8090

EXPOSE 8090

CMD ["node", "dist/index.js"]
