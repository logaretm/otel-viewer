---
---

Upgrade the worker and web app to the Sentry v11 alpha and give both a metrics layer.

v11 removes `sendDefaultPii` and its replacement, `dataCollection`, defaults to collecting request bodies, cookies, query strings and user info. In this app those categories are the user's telemetry: bodies are the OTLP and Sentry payloads, and query strings carry the receive token and room ID. Every category is now set explicitly on every surface.

The worker also redacts URLs before sending, which it never did: a captured error on `/r/{roomId}?token=...` previously carried both halves of a room's credentials into our own project. Ingest now counts what it accepts and rejects (by protocol, signal, encoding and reason), the room reports connects, closes by code, rejections and viewer counts, and a POST to a path that matches no ingest route is counted and answered with what to use instead rather than falling through to the asset handler as a silent 405.
