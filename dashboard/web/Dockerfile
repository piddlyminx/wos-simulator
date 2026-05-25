# syntax=docker/dockerfile:1.7
#
# Dev-mode image for the WOS simulator dashboard.
#
# docker-compose bind-mounts dashboard/web/ over /app so on-disk edits are
# picked up by the Next.js dev server with no image rebuild. The image itself
# only exists to pre-install node_modules (including the native better-sqlite3
# build) and provide the dev command — everything under /app is expected to be
# replaced by the host bind mount at runtime.
#
# The dashboard spawns the report-stats parser for the import flow. Battle
# simulation and ratio optimisation run in the browser via the v3 TypeScript
# web worker, so this image no longer hosts Python simulate endpoints.
# compose mounts the host dashboard/, skill/, Base_classes/, assets/, and
# fighters_data/ trees at the matching container paths so scripts can reach
# them. A dedicated /opt/sim-venv holds the Python deps for OCR/import helpers.

FROM node:20-bookworm-slim
WORKDIR /app

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
 && chown -R node:node "$rapidocr_models"

COPY dashboard/web/package.json dashboard/web/package-lock.json ./
COPY dashboard/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/.next /data/simulations /data/test_results /test_results \
 && chown -R node:node /app /data /test_results \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

USER node

RUN npm ci --no-audit --no-fund

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SIMULATOR_PYTHON=/opt/sim-venv/bin/python

ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 3000
CMD ["npm", "run", "dev:docker", "--", "--hostname", "0.0.0.0", "--port", "3000"]
