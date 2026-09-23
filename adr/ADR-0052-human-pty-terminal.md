# ADR-0052 — Human PTY terminal

## Status

Accepted, 2026-09-14.

## Context

The original Editor terminal parsed one input line into an argv array and waited for a complete response. It could not run terminal editors, interactive prompts, REPLs, completion, cursor-aware programs or long-lived processes. The operator explicitly authorized a KaxaFirme-style PTY, including full Host access after confirmation.

## Decision

Wharnex provides an in-memory, human-only PTY session with narrow open, input, resize, output-observation and close operations. `xterm` owns the keyboard and screen. The backend chooses the shell executable and binds every operation to the Harness session plus an opaque terminal id.

Sandbox remains the default. Its shell runs inside the hardened runner container over the persistent copied workspace, with network disabled unless selected before connection. The image-owned interactive profile enables programmable completion, persistent sandbox history, prefix history search and fuzzy `Ctrl+R`; developers can enter `sh` or `zsh` from the default Bash session and use the image's common programming CLIs without granting those executables to model plans. Host opens a login PTY over the real project/home mounts only after the existing dedicated confirmation and persistent warning. In the Compose/stack runtime that PTY process belongs to the trusted backend control container, not to the Desktop host process, so the backend image supplies its executable toolchain. Bash is therefore part of the backend runtime contract and Compose sets `SHELL=/bin/bash`; this specifically prevents valid project entrypoints with Bash shebangs from failing as `./script: not found` merely because the control image lacked `/bin/bash`.

PTY bytes are bounded and ephemeral. They are never persisted to the audit ledger because shell input, output and editor buffers can contain secrets. Lifecycle events may record terminal id, target and exit status without input or output. Closing or replacing the surface closes the PTY and its sandbox container.

Shell command history is runtime state owned by the project, not by the workstation account. Before starting an interactive shell, Wharnex creates a private history file below `.harness/terminal/history/` in the canonical project root and overrides `HISTFILE` for that PTY. The shell still inherits the logged-in user's normal `HOME`, `SHELL`, `PATH` and startup configuration; only the history file is redirected. Because user startup files may reassign `HISTFILE` or overwrite `PROMPT_COMMAND` (for example `vte.sh`), an environment override alone cannot hold for Bash: Wharnex starts Bash as `bash --rcfile .harness/terminal/bash-init.sh -i`, where that runtime-owned rcfile sources `/etc/profile` and the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` exactly as a login shell would, then re-pins the project `HISTFILE` and prepends the project history sync to `PROMPT_COMMAND`. GNU long options MUST precede single-letter options in the Bash argv; `bash -O … --login` exits 2 before any prompt. Zsh stays a `-l` login shell with `ZDOTDIR` pointed at the runtime-owned `.harness/terminal/zsh/`: each stage (`.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`) sources the user's file of the same name from their own `ZDOTDIR` or `HOME`, `.zshrc` and `.zlogin` then re-pin the project `HISTFILE` (with a non-zero `SAVEHIST`), and `.zlogin` hands `ZDOTDIR` back to the user. Other shells keep `-l` plus the `HISTFILE` override. Separate projects therefore never read or append the user's global host history, while reopening a terminal for the same project retains that project's commands.

The AI execution protocol is unchanged. Model plans, workflows, verification and the compatibility one-shot terminal endpoint remain structured argv operations behind Policy.

## Consequences

The human Host terminal has direct authority over the operator's real mounted project files and, in stack mode, inherits the trusted backend container's host integrations such as the Docker socket. It can bypass the one-shot interactive Policy profile; this is explicit UI authority rather than Agent authority. Its CLI availability follows the backend image instead of implicitly mirroring every workstation binary, so required baseline interpreters must be declared in that image. Interactive tools now work normally, while Agent Protected/Unprotected semantics and sandbox verification remain separate.
