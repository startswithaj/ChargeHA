# ============================================================
# ChargeHA — Multi-stage Dockerfile
#
# Build:  docker buildx build -f docker/Dockerfile --platform linux/amd64 -t chargeha .
# Run:    docker run -d --name chargeha \
#           -p 8000:8000 \
#           -v chargeha-data:/app/data \
#           -e ENCRYPTION_KEY=<base64-key> \
#           chargeha
# ============================================================

# --- Stage 1: Build Tesla HTTP proxy from Go source ---
FROM --platform=$BUILDPLATFORM golang:1.23-bookworm AS proxy-builder
RUN git clone --depth 1 https://github.com/teslamotors/vehicle-command.git /src
WORKDIR /src
ARG TARGETOS TARGETARCH
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /tesla-http-proxy ./cmd/tesla-http-proxy

# --- Stage 2: Build the client (static assets) ---
FROM denoland/deno:2.8.2 AS client-builder
ARG GIT_SHA
ENV VITE_GIT_SHA=$GIT_SHA
WORKDIR /app
COPY deno.json deno.lock* ./
COPY packages/shared/ packages/shared/
COPY packages/server/deno.json packages/server/deno.json
COPY packages/plugins/ packages/plugins/
COPY packages/client/ packages/client/
RUN deno install
RUN deno task build

# --- Stage 3: Production runtime ---
FROM denoland/deno:2.8.2

RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install cloudflared for Cloudflare Tunnel support (LAN users)
ADD https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 /usr/local/bin/cloudflared
RUN chmod +x /usr/local/bin/cloudflared

WORKDIR /app

# Copy Tesla HTTP proxy binary
COPY --from=proxy-builder /tesla-http-proxy /usr/local/bin/tesla-http-proxy

# Copy application source
COPY deno.json deno.lock* ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/plugins/ packages/plugins/
COPY packages/client/deno.json packages/client/deno.json
COPY drizzle/ drizzle/

# Copy built client assets
COPY --from=client-builder /app/packages/server/dist packages/server/dist/

# Install deps and cache compilation
RUN deno install
# See stage 2: drop the age check + purge packuments so runtime `deno run` stays
# lean (~800MB->~70MB RAM). deno.lock keeps versions pinned/vetted.
RUN sed -i '/minimumDependencyAge/d' deno.json
RUN find "${DENO_DIR}/npm/registry.npmjs.org" -name registry.json -delete
RUN deno cache packages/server/src/main.ts

# Create data directory
RUN mkdir -p /app/data

# Copy entrypoint
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["deno", "run", "--allow-net", "packages/server/src/healthcheck.ts"]

ENTRYPOINT ["/app/entrypoint.sh"]
