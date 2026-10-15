FROM python:3.12.14-slim-bookworm AS backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements-prod.lock pyproject.toml ./
RUN pip install -r requirements-prod.lock
COPY backend/src backend/src
RUN pip install --no-deps . && useradd --uid 10001 --no-create-home app
COPY alembic.ini ./
COPY backend/migrations backend/migrations
USER 10001:10001
CMD ["uvicorn", "planerbot.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM node:24.12.0-bookworm-slim AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build:check

FROM nginx:1.28-alpine AS gateway
COPY --from=frontend /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

FROM debian:bookworm-slim AS tunnel
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["ssh"]
