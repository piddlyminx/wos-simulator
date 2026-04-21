# syntax=docker/dockerfile:1.7
#
# Dev-mode image for the WOS simulator dashboard.
#
# docker-compose bind-mounts dashboard/web/ over /app so on-disk edits are
# picked up by `next dev --turbopack` with no image rebuild. The image itself
# only exists to pre-install node_modules (including the native better-sqlite3
# build) and provide the dev command — everything under /app is expected to be
# replaced by the host bind mount at runtime.

FROM node:20-bookworm-slim
WORKDIR /app

# better-sqlite3 is a native module; node-gyp needs python + a C++ toolchain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
