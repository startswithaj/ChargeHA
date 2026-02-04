# oidc

Local OIDC identity provider for testing SSO authentication during development.
Uses [Dex](https://dexidp.io/) as the provider.

## Files

- **docker-compose.yml** — runs the Dex container on `http://localhost:5556`.
- **dex-config.yml** — pre-configured with a static client (`chargeha-dev`) and
  test user (`test@chargeha.local` / `password`).

## Usage

```sh
docker compose -f devtools/oidc/docker-compose.yml up
```
