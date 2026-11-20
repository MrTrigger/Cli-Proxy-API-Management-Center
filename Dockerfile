FROM golang:1.26-bookworm AS backend
WORKDIR /backend
ARG BACKEND_COMMIT=6faa8d20b2673404cff70a2f2d9537ae0d0e684d
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
    -ldflags="-s -w -X main.Version=v8.0.79-triggerlab-ipv4-quota-recheck -X main.Commit=${BACKEND_COMMIT}" \
    -o /backend/CLIProxyAPI ./cmd/server/

FROM oven/bun:1.3.14 AS console
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG VERSION=1.25.2-triggerlab
ENV VERSION=${VERSION}
RUN bun run build

FROM eceasy/cli-proxy-api:v8.0.79@sha256:ce02dd2ba9186024762d8b6525c068c5a5fab78435b8d82d9c03f7ce74feeb5b
ENV MANAGEMENT_STATIC_PATH=/CLIProxyAPI/static TZ=Europe/Stockholm CLIPROXY_QUOTA_RECHECK_SECONDS=60
COPY --from=backend /backend/CLIProxyAPI /CLIProxyAPI/CLIProxyAPI
COPY --from=console /app/dist/index.html /CLIProxyAPI/static/management.html
