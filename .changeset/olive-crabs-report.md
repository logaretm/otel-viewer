---
'teley-cli': patch
---

Report the CLI's own health through `@sentry/node` instead of `@sentry/bun`, and name the integrations it loads rather than subtracting from the defaults. Nothing the bun SDK added was in use: its two bun-server integrations were already filtered out (and crash `init` on one runtime each if they are not), and the CLI makes no outgoing HTTP for its fetch instrumentation to see. Less is sent about the machine as a result, since the context integration's boot time, CPU model, memory size, locale and timezone are gone, while the runtime and OS it ran on are now reported correctly under both bun and node.
