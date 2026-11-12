# Simple-Point Lite API / worker image (same image; the command selects the role).
# Multi-arch: build for linux/arm64 to run on AWS Graviton Fargate (cheaper per vCPU).
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    SPL_DATA_DIR=/data SPL_PROJ_GRID_DIR=/opt/proj-grids
WORKDIR /app

COPY backend/ ./
RUN pip install --upgrade pip && pip install ".[postgres,aws]"

# GSI geoid grids (JPGEO2024 + GSIGEO2011, CC-BY 4.0) baked into the image (SPL_PROJ_GRID_DIR)
COPY scripts/fetch_grids.py /tmp/fetch_grids.py
RUN python /tmp/fetch_grids.py

RUN useradd --system --uid 10001 spl && mkdir -p /data && chown spl /data
USER spl
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
