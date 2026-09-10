# Effort levels and autonomous iteration budgets

Wharnex now treats the chat-composer effort level as a project-scoped autonomous iteration budget for one Main Request chain.

- `low`: 1 total autonomous AI attempt. The initial attempt uses the entire budget, so there is no automatic correction round.
- `medium`: up to 3 total autonomous AI attempts.
- `high`: up to 6 total autonomous AI attempts.
- `extra_high`: up to 10 total autonomous AI attempts and post-success continuous improvement.
- `max`: up to 15 total autonomous AI attempts and post-success continuous improvement.
- `ultra`: up to 30 total autonomous AI attempts and post-success continuous improvement.
- `loop`: no numeric ceiling and post-success continuous improvement; it must still terminate when the planner reports that no material, safe, scope-aligned improvement remains.

The number is a ceiling, not a quota. The planner is instructed to balance expected benefit against risk, cost, and churn on every round and to stop early when another automated change is not worthwhile.

Continuous-improvement rounds are only considered in Auto mode after a successful host integration. They refresh the project context before planning the next improvement and remain tied to the original Main Request goal.

Manual operator-triggered repair does not consume the autonomous effort budget. Infrastructure and transport recovery that do not require a new AI resolution attempt also remain outside the budget.

The frontend persists the selected effort level per project, synchronizes it to all live chat sessions for that project, and child orchestrator sessions inherit the owner's effort level.
