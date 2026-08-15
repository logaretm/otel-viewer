---
'teley-cli': minor
---

Add `teley mcp`, which serves the room to a coding agent over MCP (stdio, 2026-07-28 spec). Tools cover the debugging loop: `get_dsn` to point an SDK at the room, `wait_for_traces` to block until a run settles, then `list_traces`, `get_trace`, and `list_logs` to read the result back as text sized for a model.
