// Lightweight healthcheck script for Docker HEALTHCHECK.
const res = await fetch(
  "http://localhost:8000/trpc/health.encryption?batch=1&input=%7B%7D",
);
Deno.exit(res.ok ? 0 : 1);
