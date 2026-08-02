FROM node:22-alpine
RUN apk add --no-cache git
ARG VCP_REF=master
# Pin VCP_REF to a commit SHA in CI. Fetch the ref explicitly — a plain
# depth-1 clone only has the default-branch tip, so `checkout <sha>` would
# fail; and a swallowed failure (|| true) would silently run master while
# claiming a pin. A bad ref must fail the build loudly.
RUN git clone --no-checkout --depth 1 \
    https://github.com/solidstudiosh/ocpp-virtual-charge-point /vcp \
  && cd /vcp \
  && git fetch --depth 1 origin "${VCP_REF}" \
  && git checkout FETCH_HEAD
WORKDIR /vcp
RUN npm ci
EXPOSE 9999
CMD ["npx", "tsx", "index_16.ts"]
