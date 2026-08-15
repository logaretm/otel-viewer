---
'teley-cli': patch
---

Say what is wrong instead of throwing when the CLI is run under Node: the TUI needs bun or Node 26.4+ with `--experimental-ffi`, and `--local` needs bun. `--json` and `mcp` already ran on any Node and are untouched.
