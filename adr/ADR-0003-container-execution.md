# ADR-0003: Container-first execution

**Status:** Accepted

Model-proposed operations execute in an isolated Docker workspace by default. Host mutation is a later explicit apply step.

Network remains disabled by default. When an offline Go module-cache preflight fails, Wharness classifies the condition as local infrastructure and pauses instead of asking the planner to repair source code. A dedicated, prominent human action may retry only Go dependency/build/verification argv commands from that failed plan with Docker bridge networking. Downloads populate the copied workspace's private module cache; the original project and host module cache are never mounted or mutated, and subsequent unapproved commands return to offline execution.
