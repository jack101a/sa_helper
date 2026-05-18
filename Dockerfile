# Stage 1: Build frontend assets
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Final Image
FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update || (sleep 5 && apt-get update) && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hin \
    libgl1-mesa-glx \
    libglib2.0-0 \
    postgresql-client \
    rclone \
    age \
    gnupg \
    tar \
    gzip \
    zip \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY backend/ /app/backend/
COPY extension/ /app/extension/
COPY backend/config/ /opt/sa-helper-seed/backend/config/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

# Pre-create all runtime-writable directories and set ownership to default app user (1000:1000).
# This allows the container to run as any PUID:PGID without hitting permission denied
# on paths that are internal to the image layer (not covered by volume mounts).
RUN groupadd -g 1001 app && \
    useradd -u 1001 -g 1001 --create-home --shell /usr/sbin/nologin app && \
    mkdir -p \
        /app/backend/app/templates \
        /app/backend/app/static/extensions \
        /app/backend/logs \
        /app/backend/config \
        /app/data \
        /app/import && \
    cp /app/frontend/dist/index.html /app/backend/app/templates/admin.html && \
    chown -R 1001:1001 /app /opt/sa-helper-seed && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    CONFIG_PATH=/app/backend/config/config.yaml \
    ONNX_PATH=/app/data/models/model.onnx
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD curl -f http://localhost:8080/readyz || exit 1

# Start command
USER 1001:1001
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
