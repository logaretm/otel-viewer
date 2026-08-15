---
---

Move the OTLP request reader (decompression, encoding and signal detection) and the Sentry auth parsing out of the worker and into `shared/parsers`, and put the CLI's room behind a telemetry-source interface. Groundwork with no user-visible change.
