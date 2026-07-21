# Gateway tests

Project-level Gateway tests live under `crates/gateway/test` and cover the pure Go service boundary.

| Directory | Coverage |
|---|---|
| `auth/` | HTTP bearer authentication. |
| `http/` | Health, API auth/status, uploads, shares, and API-only 404 behavior. |
| `upload/` | `/api/files/import` validation and Agent forwarding. |
| `websocket/` | Browser/Agent/terminal WebSocket protocol, routing, streaming, and cancellation. |

The Gateway does not contain frontend tests or frontend build helpers. All React tests live under `crates/fronted/test` and run in the Unified Frontend CI job.
