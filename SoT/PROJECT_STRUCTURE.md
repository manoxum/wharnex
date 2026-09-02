# Project Structure SoT

Production code stays under domain-aligned service roots:

- `/services/frontend` — React workspace UI.
- `/services/backend` — Go orchestration/API core.
- `/services/desktop` — Electron native composition shell and narrow desktop bridge.

Cross-cutting schemas live in `/schemas`; normative documents live in `/SoT`; container execution assets live in `/docker`; repository automation lives in `/scripts`.
