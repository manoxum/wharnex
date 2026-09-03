# `whaness.yml`

Wharness creates `whaness.yml` in the project root the first time the project is opened, created, or cloned. The file is intended to be committed with the project so context behavior is reproducible across machines.

```yaml
version: 1
project:
  name: "example"
context:
  auto_exclude: true
  max_file_bytes: 2097152
  include: []
  exclude:
    - "fixtures/**"
    - "legacy/**"
    - "*.generated.ts"
```

`auto_exclude` removes common dependencies, caches, build/test output, IDE metadata, temporary artifacts, archives, binaries/media, and generated Wharness context snapshots. `include` is an optional allowlist: when non-empty, only matching eligible files enter the AI context, and an explicitly selected eligible path may bypass heuristic auto-pruning. `exclude` removes additional project-specific paths. `max_file_bytes` sets a per-file context ceiling from 1 MiB through 64 MiB in the UI.

Patterns are project-relative and support path segments with `*`, `?`, and recursive `**`. Parent traversal and absolute patterns are rejected.

Security exclusions are not configurable. Secrets, private keys, protected credential paths, VCS internals, and symlinks remain outside the context even if another pattern would select them.
