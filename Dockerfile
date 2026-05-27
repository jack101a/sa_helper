# Stage 1: Build Frontend
FROM node:20 AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build
RUN cp "$(readlink -f node_modules/.bin/esbuild)" /tmp/esbuild

# Stage 2: Final Image
FROM python:3.11-bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update || (sleep 5 && apt-get update) && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hin \
    libgl1-mesa-glx \
    libglib2.0-0 \
    zip \
    curl \
    rclone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY backend/ /app/backend/
COPY extension/ /app/extension/
COPY scripts/pack_user_extension_release.sh /app/scripts/pack_user_extension_release.sh
COPY scripts/user_extension_templates/ /app/scripts/user_extension_templates/
COPY backend/config/ /opt/sa-helper-seed/backend/config/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=frontend-builder /frontend/dist /app/frontend/dist
COPY --from=frontend-builder /tmp/esbuild /usr/local/bin/esbuild

# Link the built dashboard and create empty dynamic-data folders.
RUN mkdir -p /app/backend/app/templates && \
    cp /app/frontend/dist/index.html /app/backend/app/templates/admin.html && \
    mkdir -p /app/backend/logs \
             /app/data/automation_scripts \
             /app/data/extension_packages \
             /app/data/exam_offline \
             /app/data/hashes \
             /app/data/mappings \
             /app/data/models \
             /app/data/payment_screenshots \
             /app/data/questions \
             /app/data/security && \
    chmod +x /usr/local/bin/esbuild && \
    chmod +x /app/scripts/pack_user_extension_release.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

# Environment variables
ENV PYTHONPATH=/app/backend \
    CONFIG_PATH=/app/backend/config/config.yaml \
    SQLITE_PATH=/app/backend/logs/app.db \
    ONNX_PATH=/app/data/models/model.onnx
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:8080/health || exit 1

# Start command
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
