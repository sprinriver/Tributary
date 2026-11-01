# syntax=docker/dockerfile:1.7
# apps/compute (FastAPI). Build from the repository root: docker build -f apps/compute/Dockerfile -t tributary-compute .
# Behind a TLS-inspecting proxy, pass its CA certificate: --secret id=ca,src=/path/to/ca.pem
FROM python:3.12.12-slim-bookworm
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
WORKDIR /app/apps/compute
# Dependencies first (cached), then the code; the lockfile is used as is (never re-resolved).
COPY apps/compute/pyproject.toml apps/compute/uv.lock ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export SSL_CERT_FILE=/run/secrets/ca PIP_CERT=/run/secrets/ca; fi \
 && pip install --no-cache-dir uv==0.11.32 \
 && uv sync --frozen --no-dev --no-install-project
COPY apps/compute/ ./
RUN useradd --system --uid 10001 compute
USER compute
EXPOSE 8000
CMD ["uvicorn", "tributary_compute.main:app", "--host", "0.0.0.0", "--port", "8000"]
