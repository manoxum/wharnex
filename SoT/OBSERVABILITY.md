# Observability SoT

Every session emits ordered events with timestamp, type, session ID, and concise data. Events include context, planning, policy, execution, command, patch, verification, apply, and failure transitions.

Secret values must be redacted before event publication.

## Self-evolution observability (v1.2.22)

Self-evolution publishes dedicated `self_evolution.*` events for transaction start, host build, rollback and restart scheduling. The detached supervisor persists its last lifecycle phase in `.harness/self-evolution/status` and appends restart/recovery output to `.harness/logs/self-evolution.log`. `make status` surfaces the latest self-evolution phase and plan id even across a process restart.
