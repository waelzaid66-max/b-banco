---
name: BANCO API logging & esbuild-pino coupling
description: pino transport channels in the API server are bundled by esbuild-plugin-pino; any new transport must be registered in build.mjs or it fails at runtime.
---

# pino transports are bundled, not externalized

The api-server (`artifacts/api-server`) is bundled with esbuild and uses
`esbuild-plugin-pino` (see `build.mjs`). pino transports run in worker threads
and are emitted as **separate bundle files** by the plugin. The plugin only
emits the transports listed in its `transports: [...]` array.

**Rule:** Any pino transport used at runtime (a `transport.targets` entry in
`src/lib/logger.ts`) MUST also be listed in the `esbuildPluginPino({ transports })`
array in `build.mjs`. (`pino/file` is internal to pino and does not need listing.)

**Why:** If a runtime transport is missing from the plugin list, the build
succeeds but the logger worker throws "unable to determine transport target" at
boot and the process can crash — typecheck won't catch it.

**How to apply:** When adding a log channel/destination, update both
`src/lib/logger.ts` and `build.mjs` in lockstep, then rebuild and restart.
Check the live values in those two files rather than trusting a remembered list.

# Access-log: ONE line per request, and where the logger must mount

There are two request loggers wired in `app.ts`: `pino-http` (mounted early) and
the custom `requestLogger`. They both emit a per-request completion line, so
leaving both auto-logging = every request logged TWICE (a lowercase pino-http
"request completed" with req/res objects + an uppercase custom "Request
completed" with request_id/endpoint/duration_ms/status).

**Rule:** Keep `pino-http` with `autoLogging: false` (it is still needed to
attach `req.log`/`req.id`, used by `uploadController` and the req serializer /
seed). Let the custom `requestLogger` emit the single access line. `requestLogger`
also skips `OPTIONS` (CORS preflights are protocol chatter — a cross-origin
authenticated client preflights every poll and floods the log/metrics).

**Why:** With pino-http autoLogging OFF, anything that terminates *before*
`requestLogger` becomes invisible to BOTH the access log and `recordRequest()`
metrics. So `requestLogger` MUST be mounted early — after the Clerk proxy but
BEFORE compression, CORS, the CSRF-origin guard, body parsers, and Clerk auth —
or CSRF 403s, body-size / malformed-JSON rejections, and auth failures go
unlogged. Mounting it late (near the router) is the trap.

**How to apply:** api-server dev has NO file-watch — restart the workflow to
apply. Verify at runtime: valid GET logs once, OPTIONS logs zero, a cross-origin
unsafe POST (403 FORBIDDEN) logs exactly once.

# refresh_all_logs writes SNAPSHOTS, not live tails

The files under `/tmp/logs/*.log` are point-in-time snapshots written by the
`refresh_all_logs` tool, not a live tail. After a code change + workflow restart,
grepping the existing `/tmp/logs` file shows STALE pre-restart lines. Re-run
`refresh_all_logs` to get a fresh snapshot before grepping/verifying.
