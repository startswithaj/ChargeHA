# SAP e-mobility-charging-stations-simulator, built from a pinned git clone.
# Apache-2.0 upstream (https://github.com/SAP/e-mobility-charging-stations-simulator);
# not vendored into this repo.
#
# One image, two configurations, selected by CONFIG_SET:
#   dev — one station, connects to a dev server on the host. Paired with the
#         Vue dashboard in web.Dockerfile.
#   e2e — two stations (sap-test reports every measurand, sap-basic only the
#         energy register so measurand negotiation has something to negotiate),
#         connects to the `app` service by its compose DNS name.
# Build context is the repo root so both compose files can reach this one
# Dockerfile: docker/docker-compose.e2e.yml passes e2e, docker-compose.yml here
# takes the dev default.
FROM node:22-alpine AS builder
RUN apk add --no-cache git build-base python3
# Upstream's default branch is `main`. A SHA, not a branch name, is the pin.
# web.Dockerfile pins the same SHA — the dashboard speaks the ui-server
# protocol version the simulator ships, so a split pin can desync them.
ARG SAP_SIM_REF=41b9751fb4f61fb021aab1e018d8c77edb9c5446
# Fetch the ref explicitly — a plain depth-1 clone only has the default-branch
# tip, so `checkout <sha>` would fail outright. A bad ref must fail the build
# loudly rather than silently running the default branch's tip.
RUN git clone --no-checkout --depth 1 \
    https://github.com/SAP/e-mobility-charging-stations-simulator /sim \
  && cd /sim \
  && git fetch --depth 1 origin "${SAP_SIM_REF}" \
  && git checkout FETCH_HEAD
WORKDIR /sim
RUN npm install -g --ignore-scripts corepack && corepack enable

ARG CONFIG_SET=dev

# Our config/template/EV-profile replace and extend upstream's bundled
# src/assets before the build step (scripts/bundle.js) copies src/assets/**
# into dist/assets/**. This is why config/templates get baked into the image
# instead of bind-mounted: upstream's own build already does the same copy
# from src/assets, so following that path needs no extra machinery, and the
# result matches how the upstream Dockerfile ships its own docker/config.json.
# evProfilesFile resolves by basename() only, and the bundler only picks up
# EV profile files matching `ev-profiles*.json` (not `-template`) at the root
# of src/assets — NOT inside station-templates/. Keep this filename pattern.
COPY devtools/sap-ocpp-simulator/config/${CONFIG_SET}/config.json \
     src/assets/config.json
# Whole directory, so a config set can ship one station or several without
# this Dockerfile knowing how many.
COPY devtools/sap-ocpp-simulator/config/${CONFIG_SET}/station-templates/ \
     src/assets/station-templates/
COPY devtools/sap-ocpp-simulator/config/${CONFIG_SET}/ev-profiles.json \
     src/assets/ev-profiles.json
COPY devtools/sap-ocpp-simulator/config/${CONFIG_SET}/idtags.json \
     src/assets/idtags.json

RUN pnpm install --ignore-scripts --frozen-lockfile \
  && pnpm build

FROM node:22-alpine
WORKDIR /usr/app
COPY --from=builder /sim/node_modules ./node_modules
COPY --from=builder /sim/dist ./dist
COPY --from=builder /sim/package.json /sim/README.md /sim/LICENSE ./

CMD ["node", "dist/start.js"]
