# Testing Strategy SoT

Required layers:

- unit tests: context filtering, protocol validation, policy, path safety, state transitions;
- integration tests: executor with fake runner and temp repositories;
- security tests: denied executables, traversal, invalid patches, network escalation;
- frontend component/unit tests;
- E2E happy path and manual-plan flow;
- race tests for Go state/event stores.

Tests should assert invariants, not only line coverage.
