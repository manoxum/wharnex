# V1 Validation Record

Validated in the build environment on 2026-09-02.

## Passed

- `gofmt` on backend source.
- `go test ./...`.
- `go test -race ./...`.
- `go vet ./...`.
- `go build ./cmd/harness` (binary removed from release tree afterward).
- OpenAI adapter contract test with `httptest` for `/files` + `/responses`.
- Context secret filtering tests.
- Protocol/path traversal tests.
- Policy dangerous-command tests.
- Sandbox/host separation integration test.
- HTTP smoke flow: create session -> manual prompt -> submit plan -> sandbox execute -> verify host unchanged -> explicit apply -> host changed.
- JSON schema files parse successfully.
- `compose.yml` parses as YAML.
- shell scripts pass `sh -n`.
- React/TypeScript source passed a compiler syntax/type-shape scan using the available global TypeScript compiler and temporary external-module stubs.

## Not executable in this build environment

- Full `npm install`, ESLint, Vitest, Playwright, and Vite production build: package registry/network access was unavailable and dependencies were not preinstalled.
- Docker runner build/execution: Docker CLI/daemon was unavailable in the build environment.
- Live OpenAI API request: no user API key was used. The HTTP adapter is covered by a local contract test instead.

These limitations are environmental, not silently treated as passing gates.
