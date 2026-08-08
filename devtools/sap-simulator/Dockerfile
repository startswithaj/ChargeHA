# SAP e-mobility-charging-stations-simulator, built from a pinned git clone.
# Apache-2.0 upstream (https://github.com/SAP/e-mobility-charging-stations-simulator);
# not vendored into this repo. Mirrors the pin-by-SHA convention in
# docker/vcp.Dockerfile (the other simulator devtool).
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

# Our config/template/EV-profile replace and extend upstream's bundled
# src/assets before the build step (scripts/bundle.js) copies src/assets/**
# into dist/assets/**. This is why config/templates get baked into the image
# instead of bind-mounted: upstream's own build already does the same copy
# from src/assets, so following that path needs no extra machinery, and the
# result matches how the upstream Dockerfile ships its own docker/config.json.
# evProfilesFile resolves by basename() only, and the bundler only picks up
# EV profile files matching `ev-profiles*.json` (not `-template`) at the root
# of src/assets — NOT inside station-templates/. Keep this filename pattern.
COPY config.json src/assets/config.json
COPY station-template.json src/assets/station-templates/vcp-dev-2.station-template.json
COPY ev-profiles-vcp-dev-2.json src/assets/ev-profiles-vcp-dev-2.json
COPY idtags.json src/assets/idtags.json

RUN pnpm install --ignore-scripts --frozen-lockfile \
  && pnpm build

FROM node:22-alpine
WORKDIR /usr/app
COPY --from=builder /sim/node_modules ./node_modules
COPY --from=builder /sim/dist ./dist
COPY --from=builder /sim/package.json /sim/README.md /sim/LICENSE ./
EXPOSE 8080
CMD ["node", "dist/start.js"]
