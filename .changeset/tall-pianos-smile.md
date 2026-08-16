---
'teley-cli': minor
---

Run `--local` on Node as well as bun. Its ingest server moved from `Bun.serve` to `node:http`, which both runtimes implement, so there is one server rather than one per runtime and the two are provably serving the same routes. The TUI still needs bun or Node 26.4+ with `--experimental-ffi`.
