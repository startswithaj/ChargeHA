FROM denoland/deno:alpine
WORKDIR /app
# Needs the plugin's KlapCrypto + its errors.ts import — build context is
# the repo root.
COPY packages/plugins/chargers/tapo/server/KlapCrypto.ts \
     packages/plugins/chargers/tapo/server/KlapCrypto.ts
COPY packages/plugins/chargers/tapo/server/errors.ts \
     packages/plugins/chargers/tapo/server/errors.ts
COPY devtools/tapo-simulator/ devtools/tapo-simulator/
EXPOSE 80 8081
CMD ["run", "--allow-net", "devtools/tapo-simulator/main.ts"]
