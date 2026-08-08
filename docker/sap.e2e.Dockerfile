# SAP e-mobility-charging-stations-simulator, built from a pinned git clone,
# configured for the e2e stack (own station id, ATG disabled, connects to the
# `app` service by its compose DNS name rather than host.docker.internal).
# Apache-2.0 upstream (https://github.com/SAP/e-mobility-charging-stations-simulator);
# not vendored into this repo. Same pin as devtools/sap-simulator/Dockerfile —
# keep the two SHAs in sync when bumping either.
FROM node:22-alpine AS builder
RUN apk add --no-cache git build-base python3
# Upstream's default branch is `main`. A SHA, not a branch name, is the pin.
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

# Same asset-bake approach as devtools/sap-simulator/Dockerfile (see the
# comment there for why): our config/template/EV-profile files replace and
# extend upstream's bundled src/assets before the build step copies
# src/assets/** into dist/assets/**.
COPY docker/sap-e2e/config.json src/assets/config.json
COPY docker/sap-e2e/station-template.json src/assets/station-templates/vcp-test.station-template.json
COPY docker/sap-e2e/ev-profiles-e2e.json src/assets/ev-profiles-e2e.json
COPY docker/sap-e2e/idtags.json src/assets/idtags.json

RUN pnpm install --ignore-scripts --frozen-lockfile \
  && pnpm build

FROM node:22-alpine
WORKDIR /usr/app
COPY --from=builder /sim/node_modules ./node_modules
COPY --from=builder /sim/dist ./dist
COPY --from=builder /sim/package.json /sim/README.md /sim/LICENSE ./
EXPOSE 8080
CMD ["node", "dist/start.js"]
