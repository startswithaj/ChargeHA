# SAP simulator's Vue dashboard (ui/web), built from the same pinned clone as
# Dockerfile. Apache-2.0 upstream; not vendored into this repo.
FROM node:22-alpine AS builder
RUN apk add --no-cache git build-base python3
# Keep this SHA in step with Dockerfile's SAP_SIM_REF — the dashboard talks the
# ui-server protocol version the simulator ships, so a split pin can desync them.
ARG SAP_SIM_REF=41b9751fb4f61fb021aab1e018d8c77edb9c5446
RUN git clone --no-checkout --depth 1 \
    https://github.com/SAP/e-mobility-charging-stations-simulator /sim \
  && cd /sim \
  && git fetch --depth 1 origin "${SAP_SIM_REF}" \
  && git checkout FETCH_HEAD
WORKDIR /sim
RUN npm install -g --ignore-scripts corepack && corepack enable

# public/config.json is served TO the browser, so its host/port are resolved by
# the browser on the host machine — not from inside this container. It must
# therefore name the published port (18080), never the compose service name.
COPY devtools/sap-ocpp-simulator/web-config.json ui/web/public/config.json

RUN pnpm install --ignore-scripts --frozen-lockfile \
  && pnpm --filter web build

FROM node:22-alpine
WORKDIR /usr/app
COPY --from=builder /sim/ui/web/package.json ./
# Both trees are required: pnpm hoists shared deps (start.js needs
# `finalhandler`) into the workspace root, while ui/web keeps its own.
# Node resolves /node_modules by walking up from /usr/app.
COPY --from=builder /sim/node_modules /node_modules
COPY --from=builder /sim/ui/web/node_modules ./node_modules
COPY --from=builder /sim/ui/web/dist ./dist
COPY --from=builder /sim/ui/web/start.js ./
EXPOSE 3030
CMD ["node", "start.js"]
