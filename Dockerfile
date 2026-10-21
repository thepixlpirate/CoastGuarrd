# ---- Web interface ----------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=warn
COPY web/ ./
RUN npm run build

# ---- Server -----------------------------------------------------------------
FROM node:22-bookworm-slim AS server
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
# The encrypted-database add-on ships ready-made binaries, so nothing needs compiling.
RUN npm ci --no-audit --no-fund --ignore-scripts \
 && node -e "require('better-sqlite3-multiple-ciphers')(':memory:').prepare('select 1').get()"
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- Final image ------------------------------------------------------------
FROM node:22-bookworm-slim
ARG CG_VERSION=dev
ENV NODE_ENV=production \
    CG_VERSION=${CG_VERSION} \
    CG_PORT=8787 \
    CG_DATA_DIR=/config \
    CG_MEDIA_ROOT=/media \
    CG_WEB_DIR=/app/public \
    PUID=99 \
    PGID=100 \
    UMASK=002

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server /src/server/node_modules ./node_modules
COPY --from=server /src/server/dist ./dist
COPY --from=server /src/server/package.json ./package.json
COPY --from=web /src/web/dist ./public
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /config /media

EXPOSE 8787
VOLUME ["/config"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CG_PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.title="CoastGuarrd" \
      org.opencontainers.image.description="Watch tracking and safe library cleanup for Jellyfin, Seerr and the *arr apps." \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["node", "dist/index.js"]
