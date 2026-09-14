# ADR-0052 — Human PTY terminal

## Status

Accepted, 2026-09-14.

## Context

The original Editor terminal parsed one input line into an argv array and waited for a complete response. It could not run terminal editors, interactive prompts, REPLs, completion, cursor-aware programs or long-lived processes. The operator explicitly authorized a KaxaFirme-style PTY, including full Host access after confirmation.

## Decision

Wharnex provides an in-memory, human-only PTY session with narrow open, input, resize, output-observation and close operations. `xterm` owns the keyboard and screen. The backend chooses the shell executable and binds every operation to the Harness session plus an opaque terminal id.

Sandbox remains the default. Its shell runs inside the hardened runner container over the persistent copied workspace, with network disabled unless selected before connection. The image-owned interactive profile enables programmable completion, persistent sandbox history, prefix history search and fuzzy `Ctrl+R`; developers can enter `sh` or `zsh` from the default Bash session and use the image's common programming CLIs without granting those executables to model plans. Host opens the local user's login shell in the real project root only after the existing dedicated confirmation and persistent warning.

PTY bytes are bounded and ephemeral. They are never persisted to the audit ledger because shell input, output and editor buffers can contain secrets. Lifecycle events may record terminal id, target and exit status without input or output. Closing or replacing the surface closes the PTY and its sandbox container.

The AI execution protocol is unchanged. Model plans, workflows, verification and the compatibility one-shot terminal endpoint remain structured argv operations behind Policy.

## Consequences

The human Host terminal has the same authority as the operating-system user and can bypass the one-shot interactive Policy profile. This is explicit UI authority rather than Agent authority. Interactive tools now work normally, while Agent Protected/Unprotected semantics and sandbox verification remain separate.
