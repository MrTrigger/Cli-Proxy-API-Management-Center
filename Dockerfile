FROM golang:1.26-bookworm AS backend
WORKDIR /backend
ARG BACKEND_COMMIT=6fecc6e5567912661654a4eaf9b8f5436facd1c2
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git \
 && rm -rf /var/lib/apt/lists/* \
 && git init . \
 && git remote add origin https://github.com/router-for-me/CLIProxyAPI.git \
 && git fetch --depth 1 origin ${BACKEND_COMMIT} \
 && git checkout --detach FETCH_HEAD
COPY backend-patches/utls-ipv4.patch /tmp/utls-ipv4.patch
RUN git apply --check /tmp/utls-ipv4.patch && git apply /tmp/utls-ipv4.patch \
 && go test ./internal/runtime/executor/helps \
 && CGO_ENABLED=1 GOOS=linux go build -buildvcs=false \
    -ldflags="-s -w -X main.Version=v8.0.10-triggerlab-ipv4 -X main.Commit=${BACKEND_COMMIT}" \
    -o /backend/CLIProxyAPI ./cmd/server/

FROM oven/bun:1.3.14 AS console
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG VERSION=1.25.2-triggerlab
ENV VERSION=${VERSION}
RUN bun run build

FROM eceasy/cli-proxy-api:v8.0.10@sha256:0b007a6abd15aec1f5314908417ceab99f049f75353e3703f52f0968747f6110
ENV MANAGEMENT_STATIC_PATH=/CLIProxyAPI/static TZ=Europe/Stockholm
COPY --from=backend /backend/CLIProxyAPI /CLIProxyAPI/CLIProxyAPI
COPY --from=console /app/dist/index.html /CLIProxyAPI/static/management.html
