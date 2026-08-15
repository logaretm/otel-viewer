---
'teley-cli': minor
---

The CLI now reports on itself: crashes, relay close codes, ingest rejections and MCP tool outcomes go to Teley's own Sentry project, so a published binary is no longer undebuggable. Tool calls also emit metrics (call counts by outcome, durations, and how many traces `wait_for_traces` actually returned), which is the only visibility `--local` ingest can ever have since no relay sees it.

Your telemetry is not part of that and never has been: no spans, logs, attribute values, payload bodies, room IDs or tokens leave the CLI, and errors raised while handling a payload report only the error's class name. See "What the CLI reports about itself" in the README.

Uses the Sentry v11 alpha SDK, where `sendDefaultPii` is gone and `dataCollection` defaults are permissive, so every category is set explicitly rather than inherited.
