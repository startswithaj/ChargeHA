FROM node:22-alpine
RUN apk add --no-cache git
# Upstream's default branch is `main`; `master` still exists but was abandoned
# at 8b65895 (2025-03-19), so a `master` default silently pinned us to a dead
# branch. Default to a SHA on `main` instead — a branch name is not a pin.
ARG VCP_REF=df2b8d749fdbb0493d1582f9ea7a3d55712c2666
# Fetch the ref explicitly — a plain depth-1 clone only has the default-branch
# tip, so `checkout <sha>` would fail; and a swallowed failure (|| true) would
# silently run the default branch while claiming a pin. A bad ref must fail the
# build loudly.
RUN git clone --no-checkout --depth 1 \
    https://github.com/solidstudiosh/ocpp-virtual-charge-point /vcp \
  && cd /vcp \
  && git fetch --depth 1 origin "${VCP_REF}" \
  && git checkout FETCH_HEAD
WORKDIR /vcp
# npm install, not ci: the vcp repo's lockfile is out of sync with its
# package.json upstream; ci refuses to run. The VCP_REF pin still bounds
# the source tree.
RUN npm install --no-audit --no-fund
EXPOSE 9999
# Constant 2s retry: vcp exits on any failed connect, and Docker's
# on-failure backoff grows into minutes — the charger id only gets
# configured after the stack is up, so steady retries are required.
CMD ["sh", "-c", "while true; do npx tsx index_16.ts; sleep 2; done"]
