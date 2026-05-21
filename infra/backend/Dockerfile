# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# Set the working directory in the container
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hin \
    libtesseract-dev \
    libgl1-mesa-glx \
    libglib2.0-0 \
    zip \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code
COPY backend/ /app/backend/
COPY data/ /opt/sa-helper-seed/data/
COPY backend/config/ /opt/sa-helper-seed/backend/config/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Create necessary directories
RUN cp -a /opt/sa-helper-seed/data /app/data && \
    mkdir -p /app/backend/logs /app/backend/datasets && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PYTHONPATH=/app/backend \
    CONFIG_PATH=/app/backend/config/config.yaml \
    SQLITE_PATH=/app/backend/logs/app.db \
    ONNX_PATH=/app/data/models/model.onnx

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
