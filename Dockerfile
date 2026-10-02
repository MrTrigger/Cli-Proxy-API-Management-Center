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
COPY --from=console /app/dist/index.html /CLIProxyAPI/static/management.html
