# ocpp-simulator

Standalone OCPP 1.6 virtual charge point for local development. Wraps
[ocpp-virtual-charge-point](https://github.com/solidstudiosh/ocpp-virtual-charge-point)
using the same image as the e2e stack (`docker/vcp.Dockerfile`).

Use this when you want a charger against your own dev server. The e2e stack
(`deno task e2e:up`) runs its own copy against the containerised app.

## Usage

Start the dev server first, then:

```sh
deno task dev
docker compose -f devtools/ocpp-simulator/docker-compose.yml up
```

- Charge point id: `vcp-dev`
- Admin API: `http://localhost:19999`

## Overrides

```sh
CP_ID=my-charger \
WS_URL=ws://host.docker.internal:8000/api/charger/ocpp \
ADMIN_HOST_PORT=19999 \
  docker compose -f devtools/ocpp-simulator/docker-compose.yml up
```

## Multiple chargers

The app keys every socket by the charge point id the device announces, so
several simulators can run at once. Each needs its own compose project name
(`-p`) — otherwise compose replaces the running container instead of adding one
— plus its own `CP_ID` and `ADMIN_HOST_PORT`.

```sh
CP_ID=vcp-dev-2 ADMIN_HOST_PORT=19998 \
  docker compose -p ocpp-sim-2 -f devtools/ocpp-simulator/docker-compose.yml up -d

docker compose -p ocpp-sim-2 -f devtools/ocpp-simulator/docker-compose.yml down
```
