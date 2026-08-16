# teley-cli

## 0.4.0

### Minor Changes

- [#54](https://github.com/logaretm/teley/pull/54) [`088138e`](https://github.com/logaretm/teley/commit/088138e36e908f69a603c73d96b47074996e51de) Thanks [@logaretm](https://github.com/logaretm)! - Run `--local` on Node as well as bun. Its ingest server moved from `Bun.serve` to `node:http`, which both runtimes implement, so there is one server rather than one per runtime and the two are provably serving the same routes. The TUI still needs bun or Node 26.4+ with `--experimental-ffi`.

### Patch Changes

- [#54](https://github.com/logaretm/teley/pull/54) [`088138e`](https://github.com/logaretm/teley/commit/088138e36e908f69a603c73d96b47074996e51de) Thanks [@logaretm](https://github.com/logaretm)! - Report the CLI's own health through `@sentry/node` instead of `@sentry/bun`, and name the integrations it loads rather than subtracting from the defaults. Nothing the bun SDK added was in use: its two bun-server integrations were already filtered out (and crash `init` on one runtime each if they are not), and the CLI makes no outgoing HTTP for its fetch instrumentation to see. Less is sent about the machine as a result, since the context integration's boot time, CPU model, memory size, locale and timezone are gone, while the runtime and OS it ran on are now reported correctly under both bun and node.

- [#56](https://github.com/logaretm/teley/pull/56) [`7004f4a`](https://github.com/logaretm/teley/commit/7004f4ac80d074828777614745dcfcad2f34877f) Thanks [@logaretm](https://github.com/logaretm)! - Answer an oversize payload with 413 rather than 400, and a CORS preflight with 204 rather than 200. The decompression ceiling and `--local`'s own body cap disagreed about the same refusal, one calling it undecodable and the other calling it too large, so the ceiling is now a distinct error and both are the one number the parsers already enforce.

## 0.3.0

### Minor Changes

- [#44](https://github.com/logaretm/teley/pull/44) [`18c7836`](https://github.com/logaretm/teley/commit/18c783669300710b31b984f6e35c8c7abb76b9db) Thanks [@logaretm](https://github.com/logaretm)! - Add `--local`, which makes the CLI itself the ingest endpoint instead of the relay. Point an SDK at `http://localhost:8788/r/<room-id>` (or `--port`) and telemetry never leaves the machine, works offline, and needs no room to claim. It runs the worker's own decoding, so JSON, protobuf, gzip, and Sentry envelopes all behave the same, and it composes with the TUI, `--json`, and `mcp`. The trade is that the web dashboard cannot open a local room.

  Also stops the Sentry envelope converter from writing debug lines to stdout, which corrupted `--json` output and would have broken MCP's JSON-RPC stream.

- [#48](https://github.com/logaretm/teley/pull/48) [`b90ce74`](https://github.com/logaretm/teley/commit/b90ce7494138611e734557c5ab70e9fb70430a88) Thanks [@logaretm](https://github.com/logaretm)! - The CLI now reports on itself: crashes, relay close codes, ingest rejections and MCP tool outcomes go to Teley's own Sentry project, so a published binary is no longer undebuggable. Tool calls also emit metrics (call counts by outcome, durations, and how many traces `wait_for_traces` actually returned), which is the only visibility `--local` ingest can ever have since no relay sees it.

  Your telemetry is not part of that and never has been: no spans, logs, attribute values, payload bodies, room IDs or tokens leave the CLI, and errors raised while handling a payload report only the error's class name. See "What the CLI reports about itself" in the README.

  Uses the Sentry v11 alpha SDK, where `sendDefaultPii` is gone and `dataCollection` defaults are permissive, so every category is set explicitly rather than inherited.

### Patch Changes

- [#52](https://github.com/logaretm/teley/pull/52) [`f7fdfe6`](https://github.com/logaretm/teley/commit/f7fdfe6dbd9874a22ab335ab96fc42b2456de593) Thanks [@logaretm](https://github.com/logaretm)! - Say what is wrong instead of throwing when the CLI is run under Node: the TUI needs bun or Node 26.4+ with `--experimental-ffi`, and `--local` needs bun. `--json` and `mcp` already ran on any Node and are untouched.

## 0.2.0

### Minor Changes

- [#42](https://github.com/logaretm/teley/pull/42) [`bd489c9`](https://github.com/logaretm/teley/commit/bd489c9468075c9492044e0511110d5696a854e7) Thanks [@logaretm](https://github.com/logaretm)! - Add `teley mcp`, which serves the room to a coding agent over MCP (stdio, 2026-07-28 spec). Tools cover the debugging loop: `get_dsn` to point an SDK at the room, `wait_for_traces` to block until a run settles, then `list_traces`, `get_trace`, and `list_logs` to read the result back as text sized for a model.

- [#39](https://github.com/logaretm/teley/pull/39) [`4d1b529`](https://github.com/logaretm/teley/commit/4d1b52962591df151e4ef663e455266aa4bae211) Thanks [@logaretm](https://github.com/logaretm)! - Add `--json`, a non-interactive mode that skips the TUI and streams the room to stdout as newline-delimited JSON: a session line carrying the DSN, then one line per trace and log. Pipe it into `jq`, keep it as a file, or run it in CI.

### Patch Changes

- [`c2c806f`](https://github.com/logaretm/teley/commit/c2c806fa84479c4a5b4192e21a84cd760b5bb080) Thanks [@logaretm](https://github.com/logaretm)! - Ship `CHANGELOG.md` in the published package, so `npm` and `bunx` users can read what changed without leaving the terminal.

## 0.1.7

### Patch Changes

- Accept OTLP/protobuf ingest alongside OTLP/JSON ([#34](https://github.com/logaretm/teley/pull/34))
- Read span kind in OTLP wire numbering ([#35](https://github.com/logaretm/teley/pull/35))
- Parse RFC 3339 timestamps from the Go and Python SDKs ([#32](https://github.com/logaretm/teley/pull/32))

## 0.1.6

### Patch Changes

- Make detail panels scrollable ([#31](https://github.com/logaretm/teley/pull/31))

## 0.1.4

### Patch Changes

- Add a `--version` flag ([#28](https://github.com/logaretm/teley/pull/28))
- Surface auth rejections, detect half-open sockets, and back off reconnects ([#27](https://github.com/logaretm/teley/pull/27))
- Shut down gracefully on quit instead of `process.exit(0)` ([#26](https://github.com/logaretm/teley/pull/26))

## 0.1.2

### Patch Changes

- Bound trace and log store memory by evicting on upsert ([#25](https://github.com/logaretm/teley/pull/25))

## 0.1.1

### Patch Changes

- Initial release of the terminal trace and log viewer ([#5](https://github.com/logaretm/teley/pull/5))
- Support Sentry v2 streamed and v1 standalone spans ([#6](https://github.com/logaretm/teley/pull/6))

<!--
Entries from 0.1.8 onward are generated by changesets. Everything above predates
it and was reconstructed from git history, so it is coarser and skips the
untagged 0.1.3 and 0.1.5 patch releases.
-->
