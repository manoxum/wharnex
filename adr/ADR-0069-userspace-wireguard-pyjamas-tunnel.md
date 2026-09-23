# ADR-0069: tunnel.pyjam.as through a userspace WireGuard data plane

Status: Accepted — 2026-09-23

## Context

`tunnel.pyjam.as` is a free, account-less HTTPS tunnel. Its documented client
procedure is:

```
curl https://tunnel.pyjam.as/8080 > tunnel.conf && wg-quick up ./tunnel.conf
```

The service answers a port request with a WireGuard document that it generates
per request. Reading its implementation, that document contains the client
`[Interface]` address and private key, the server `[Peer]` public key, a single
`/32` `AllowedIPs`, a UDP `Endpoint`, and a `PostUp` line. The public slug is
announced *only* inside the `PostUp` banner; no other field carries it.

Wharnex cannot adopt the documented procedure:

- `wg-quick` creates a network interface and routes, so it requires root and
  `NET_ADMIN`. The tunnel daemon container deliberately runs as an unprivileged
  user with no added capabilities.
- `wg-quick` executes `PostUp` as a **root shell string supplied by the remote
  service**. Admitting that would break `AGENTS.md` §2 (no arbitrary shell
  strings), §3 (`sudo` is never auto-approved), and the rule that remote content
  may not override harness policy. It is a remote-code-execution boundary, not a
  configuration detail.
- The procedure also tells operators to bind the local service to `0.0.0.0`,
  which `SoT/SECURITY_MODEL.md` forbids for every tunnel adapter.

## Decision

`pyjamas` is admitted as a temporary tunnel provider, implemented with a
**userspace WireGuard data plane** rather than the documented host procedure.

- The WireGuard protocol runs in-process through `wireguard-go` over a private
  gVisor network stack. No host TUN device, no root, no `NET_ADMIN`, and no
  change to host or container network configuration.
- The object server keeps its existing loopback listener unchanged. The
  userspace stack accepts the tunnelled connection on its own private address
  and proxies bytes to that loopback listener, so
  `SoT/SECURITY_MODEL.md`'s loopback-only rule continues to hold literally. The
  tunnelled listener is not a host socket at all, which is strictly narrower
  than binding loopback.
- The remote document is parsed as untrusted data and never executed.
  `PostUp` is read only to recover the announced slug; `PreUp`, `PostDown`,
  `PreDown` and every other directive are discarded. Each field is validated
  independently: the interface address and the peer `AllowedIPs` must be single
  IPv4 `/32`s inside the service's documented `10.101.0.0/16`, the UDP endpoint
  host must be `tunnel.pyjam.as`, and the announced origin must be a
  `*.tunnel.pyjam.as` HTTPS origin. A widened `AllowedIPs`, a routable address,
  a foreign endpoint or a foreign origin is rejected rather than tolerated.
- The provisioning request refuses redirects and reads a bounded response.
- The provider is temporary, never permanent-DNS. The pool document MUST NOT
  carry a `public_url` or any account field for it. After the first allocation,
  the validated WireGuard document is retained as private provider state in
  `tunnel.conf` (mode `0600`), including its originally requested local port.
  A backend restart reuses that document and port, preserving the allocated
  slug without another provisioning request. A missing document is the only
  condition that allocates a new tunnel; an invalid saved document fails closed
  rather than silently replacing the URL.

The service generates the client private key itself, so it can decrypt the
tunnel. That is the same trust position as every other TLS-terminating provider
already in the pool, and the bearer-capability namespace rules in
`SoT/SECURITY_MODEL.md` remain the control that matters.

## Consequences

- Wharnex gains a tunnel provider that needs no account, no credential, no
  installed client executable and no elevated privilege. It is the only provider
  in the catalogue whose availability is unconditional.
- The Go core takes `golang.zx2c4.com/wireguard` and `gvisor.dev/gvisor` as
  direct dependencies, which the "prefer standard library" guidance in
  `AGENTS.md` §4 otherwise discourages. A userspace TCP/IP stack cannot be
  written against the standard library, and the alternative was a root shell
  boundary the security model forbids.
- `gvisor.dev/gvisor` is pinned to an exact snapshot and that pin MUST NOT be
  advanced casually. gVisor builds with Bazel, so its published snapshots are
  not all loadable by the Go toolchain: many carry
  `pkg/tcpip/stack/bridge_test.go` declaring `package bridge_test`, which Go
  rejects as a second package in a `stack` directory, and snapshots older than
  late 2025 declare `//go:build go1.25` with no upper bound, so they fail to
  compile on Go 1.26 toolchains. An upgrade has to be build-verified against the
  toolchain in use, never taken from `@latest`.
- The Go language baseline moves from 1.23 to 1.26.3, because the only snapshot
  that satisfies both constraints requires it. The backend and tunnel images
  move to the matching `golang:1.26` base. The runner image keeps its own Go
  toolchain, which serves user projects and is unrelated to this module.
- A backend restart preserves the public URL while its private `tunnel.conf`
  remains valid. Removing that private state deliberately allocates a new URL
  on the next start.
