# syntax=docker/dockerfile:1.7
#
# Unified dashboard image for development and production.
#
# Both targets keep the app at /repo/dashboard/web and install dependencies at
# /repo/node_modules. Dev bind mounts can replace repo source trees without
# shadowing node_modules; package-lock changes are picked up by rebuilding the
# image.

FROM node:20-bookworm-slim AS base

WORKDIR /repo

# better-sqlite3 is a native module; node-gyp needs python + a C++ toolchain.
# RapidOCR/ONNX Runtime/OpenCV are needed for the OCR flow. A dedicated
# /opt/sim-venv keeps those deps out of the system Python and avoids
# --break-system-packages.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv \
      make g++ \
      libgl1 \
      libglib2.0-0 \
      libxcb1 \
      libx11-6 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock /opt/sim-deps/
RUN python3 -m venv /opt/sim-venv \
 && /opt/sim-venv/bin/pip install --no-cache-dir uv \
 && cd /opt/sim-deps \
 && UV_PROJECT_ENVIRONMENT=/opt/sim-venv /opt/sim-venv/bin/uv sync \
      --frozen --no-dev --no-install-project \
 && /opt/sim-venv/bin/uv pip uninstall --python /opt/sim-venv/bin/python opencv-python \
 && /opt/sim-venv/bin/uv pip install --python /opt/sim-venv/bin/python \
      --no-deps --reinstall "opencv-python-headless==4.13.0.92" \
 && rapidocr_models=$(/opt/sim-venv/bin/python -c 'from pathlib import Path; import rapidocr; print(Path(rapidocr.__file__).parent / "models")') \
 && chown -R node:node "$rapidocr_models" \
 && chmod -R a+rwX "$rapidocr_models"

ENV NEXT_TELEMETRY_DISABLED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SIMULATOR_PYTHON=/opt/sim-venv/bin/python \
    NODE_PATH=/repo/node_modules \
    PATH=/repo/node_modules/.bin:$PATH

FROM base AS deps

COPY dashboard/web/package.json dashboard/web/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS dev

WORKDIR /repo/dashboard/web

COPY dashboard /repo/dashboard
COPY scripts /repo/scripts
COPY skill /repo/skill
COPY simulator /repo/simulator
COPY testcases /repo/testcases
COPY shared/fighters_data /repo/shared/fighters_data

RUN mkdir -p \
      /repo/dashboard/web/.next \
      /repo/simulator/testcase_results \
      /repo/test_results \
      /data/simulations \
      /data/stat-presets \
      /test_results \
 && chown -R node:node \
      /repo/dashboard/web/.next \
      /repo/simulator/testcase_results \
      /repo/test_results \
      /data \
      /test_results

ENV NODE_ENV=development

USER node

ENTRYPOINT ["/bin/sh", "/repo/dashboard/web/docker-entrypoint.sh"]
EXPOSE 3000
CMD ["npm", "run", "dev:docker", "--", "--hostname", "0.0.0.0", "--port", "3000"]

FROM deps AS prod-build

WORKDIR /repo/dashboard/web

# Keep the same relative repo layout in the image that local builds use.
COPY dashboard /repo/dashboard
COPY simulator/src /repo/simulator/src
COPY simulator/config /repo/simulator/config

ENV NODE_ENV=production

RUN npm run build

FROM prod-build AS prod

RUN mkdir -p /data/simulations /data/test_results /test_results \
 && chown -R node:node /data /test_results

USER node

EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
