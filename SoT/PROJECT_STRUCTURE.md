# Project Structure SoT

Production code stays under domain-aligned service roots:

- `/services/frontend` — React workspace UI.
- `/services/backend` — Go orchestration/API core.
- `/services/desktop` — Electron native composition shell and narrow desktop bridge.

Cross-cutting schemas live in `/schemas`; normative documents live in `/SoT`; container execution assets live in `/docker`; repository automation lives in `/scripts`.

Every linked project root also has an engine-owned `/VERSION` file. Wharnex creates it when missing and is the sole writer; planner patches must never target it. The canonical stored form is four numeric components prefixed by `v` (`vA.B.C.D`).

Orchestrator-specific implementation follows the same boundaries:

- `/services/backend/internal/orchestrator` — project-scoped Plan/Task/TaskRun domain records, DAG/readiness rules and persistence adapter.
- `/schemas/orchestrator-plan.schema.json` — JSON Schema for the planner-only `harness.orchestrator-plan/v1` proposal contract.
- `/services/backend/internal/app/service_orchestrator_*.go` — orchestration use cases and delegation into the existing Agent pipeline.
- `/services/frontend/src/components/orchestrator` — Overview/Tasks projections and interactions; it is not a transition or scheduling authority.
- `/adr/ADR-0032-orchestrator-mode.md` — accepted responsibility, persistence and concurrency decision.
