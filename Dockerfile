FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
# The filtered Docker context includes only allowlisted server sources.
# Copy the tree so PR-only runtime modules can be packaged when present.
COPY server/ ./server/

RUN npm run build && npm --prefix server run build
# Build a curated runtime tree. Optional modules are copied only when the
# tested source candidate contains them (PR #42/#44 composition).
RUN set -eu; \
    mkdir -p /app/runtime-server; \
    cp server/index.mjs server/trusted-interactive.mjs server/aiGenerationPrompt.mjs server/aiGenerationQuality.mjs /app/runtime-server/; \
    if [ -f server/mochi-plan.mjs ]; then cp server/mochi-plan.mjs /app/runtime-server/; fi; \
    cp server/mochi-response.mjs server/studio-launcher.mjs server/unified-studio-deployment.mjs /app/runtime-server/; \
    cp -R server/mochi-ai /app/runtime-server/mochi-ai; \
    cp -R server/.generated /app/runtime-server/.generated; \
    if [ -f server/ai-abort.mjs ]; then cp server/ai-abort.mjs /app/runtime-server/; fi; \
    if [ -d server/paid-gateway ]; then mkdir -p /app/runtime-server/paid-gateway; cp server/paid-gateway/*.mjs /app/runtime-server/paid-gateway/; fi

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=7860

COPY --from=build /app/dist ./dist
COPY --from=build /app/runtime-server/ ./server/
COPY --from=build /app/src/model/appSpec.ts /app/src/model/trustedInteractive.schema.json ./src/model/
COPY --from=build /app/src/integrations/mochi-ai/protocol.mjs /app/src/integrations/mochi-ai/errors.mjs ./src/integrations/mochi-ai/
COPY --from=build /app/src/integrations/mochi/intent.mjs ./src/integrations/mochi/intent.mjs

USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.mjs"]
