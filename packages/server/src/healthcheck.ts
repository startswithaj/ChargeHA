/** Lightweight healthcheck script for Docker HEALTHCHECK. */
const res = await fetch("http://localhost:8000/trpc/health.ping?batch=1");
Deno.exit(res.ok ? 0 : 1);
