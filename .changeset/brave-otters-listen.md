---
'teley-cli': minor
---

Add `--local`, which makes the CLI itself the ingest endpoint instead of the relay. Point an SDK at `http://localhost:8788/r/<room-id>` (or `--port`) and telemetry never leaves the machine, works offline, and needs no room to claim. It runs the worker's own decoding, so JSON, protobuf, gzip, and Sentry envelopes all behave the same, and it composes with the TUI, `--json`, and `mcp`. The trade is that the web dashboard cannot open a local room.

Also stops the Sentry envelope converter from writing debug lines to stdout, which corrupted `--json` output and would have broken MCP's JSON-RPC stream.
