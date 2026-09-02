# V1.1 Scope

Implemented on top of v1.0.1:

- Editor / Agent workspace modes.
- Workspace F5 recovery and recent-workspace memory.
- Local chat transcript persistence.
- Safe file Explorer and UTF-8 editor.
- Atomic saves with SHA-256 optimistic locking.
- Automatic planner-context refresh before each Agent request.
- Persistent per-session terminal sandbox.
- Direct argv terminal execution (no implicit shell).
- Optional terminal network switch and sandbox reset.
- ChatGPT provider tab with automatic OpenAI API state or manual web bridge.

Not implemented:

- ChatGPT consumer-web iframe scraping, login detection, DOM prompt injection, or automated Output extraction.
- Monaco/LSP/debugger/git UI. These are candidates for later IDE waves.
