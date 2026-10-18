FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
COPY server/package.json server/tsconfig.json server/index.mjs \
  server/aiGenerationPrompt.mjs server/aiGenerationQuality.mjs ./server/
COPY server/mochi-ai ./server/mochi-ai

RUN npm run build && npm --prefix server run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=7860

COPY --from=build /app/dist ./dist
COPY --from=build /app/server/index.mjs /app/server/aiGenerationPrompt.mjs \
  /app/server/aiGenerationQuality.mjs ./server/
COPY --from=build /app/server/mochi-ai ./server/mochi-ai
COPY --from=build /app/server/.generated ./server/.generated
COPY --from=build /app/src/model/appSpec.ts ./src/model/appSpec.ts
COPY --from=build /app/src/integrations/mochi-ai/protocol.mjs \
  ./src/integrations/mochi-ai/protocol.mjs

USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.mjs"]
