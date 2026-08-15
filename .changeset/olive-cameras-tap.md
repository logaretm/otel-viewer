---
'teley-cli': minor
---

Add `--json`, a non-interactive mode that skips the TUI and streams the room to stdout as newline-delimited JSON: a session line carrying the DSN, then one line per trace and log. Pipe it into `jq`, keep it as a file, or run it in CI.
