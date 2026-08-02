# tapo-simulator

Fake Tapo P110 for tests: real KLAP crypto (handshake, AES-CBC, sequence and
signature verification) + simulated switch and energy meter.

- Device API (KLAP): `/app/handshake1`, `/app/handshake2`, `/app/request`
- Control API (plain JSON): `GET /state`, `POST /set` with any of
  `{ deviceOn, drawWhenOnW, overheated, unreachable, email, password,
  model, expireSession, forceMidnightReset }`
- In-process: `startTapoSimulator()` from `main.ts` (random ports)
- Container: `docker build -f devtools/tapo-simulator/Dockerfile .`

Default credentials: `user@example.com` / `example-password`.
