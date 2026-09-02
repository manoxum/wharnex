# Execution Model SoT

1. Plans are validated structurally.
2. Policy evaluates each operation.
3. Denied plans never execute.
4. Approved plans execute against an isolated copy.
5. Patches are applied in the sandbox first.
6. Commands/verification run with declared cwd, timeout, network policy, and expected exit codes.
7. Host application is a separate endpoint/action and is allowed only after successful sandbox verification.
8. The host apply step re-runs `git apply --check` before mutation.

## Interactive IDE terminal

The Editor terminal is a human-initiated execution surface. It does not execute through a shell string: the frontend parses input into argv and the backend executes argv directly in a persistent isolated project copy. The same executable policy can deny dangerous host-control commands. Network is disabled by default and is an explicit per-command user choice.

Editor file saves are explicit human mutations to the host project and use optimistic SHA-256 concurrency checks. Secret/excluded paths and symlink escapes remain inaccessible. The agent path remains sandbox-first and requires explicit Apply for host mutation.
