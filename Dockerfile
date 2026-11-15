FROM golang:1.26-bookworm AS backend
WORKDIR /backend
ARG BACKEND_COMMIT=43806c865da7d47f9252316e95e315ad9f885b84
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git \
 && rm -rf /var/lib/apt/lists/* \
 && git init . \
 && git remote add origin https://github.com/router-for-me/CLIProxyAPI.git \
 && git fetch --depth 1 origin ${BACKEND_COMMIT} \
 && git checkout --detach FETCH_HEAD
COPY backend-patches/utls-ipv4.patch backend-patches/quota-recheck.patch /tmp/
RUN git apply --check /tmp/utls-ipv4.patch && git apply /tmp/utls-ipv4.patch \
 && git apply --check /tmp/quota-recheck.patch && git apply /tmp/quota-recheck.patch \
 && go test ./internal/runtime/executor/helps \
 && go test ./sdk/cliproxy/auth -run 'QuotaRecheck|CapQuotaCooldown' \
 && CGO_ENABLED=1 GOOS=linux go build -buildvcs=false \
    -ldflags="-s -w -X main.Version=v8.0.73-triggerlab-ipv4-quota-recheck -X main.Commit=${BACKEND_COMMIT}" \
    -o /backend/CLIProxyAPI ./cmd/server/

FROM oven/bun:1.3.14 AS console
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG VERSION=1.25.2-triggerlab
ENV VERSION=${VERSION}
RUN bun run build

FROM eceasy/cli-proxy-api:v8.0.73@sha256:5727997d6407a7be54e58275d595ffeac0200eb388520b87bf2d2e1e042d9b5b
ENV MANAGEMENT_STATIC_PATH=/CLIProxyAPI/static TZ=Europe/Stockholm CLIPROXY_QUOTA_RECHECK_SECONDS=60
COPY --from=backend /backend/CLIProxyAPI /CLIProxyAPI/CLIProxyAPI
COPY --from=console /app/dist/index.html /CLIProxyAPI/static/management.html
