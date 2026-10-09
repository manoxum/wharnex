# ADR-0089 — up-whx-link: opt-in host access for applications under UI Lab test

- Status: accepted
- Date: 2026-10-03
- Amends: `adr/ADR-0072-up-whx-link-network-isolation.md` (decision 3)

## Context

UI Lab runs every test in a Desktop `BrowserWindow`, so the browser lives in
the up-whx-link network namespace. Inside it only the gateway port is
forwarded from the namespace loopback to the host loopback. Local applications
under test are host loopback services — a dev server on `localhost:5173`, or a
development reverse proxy on `0.0.0.0:443` reached through `/etc/hosts` names
such as `admin.drcae.local.com → 127.0.0.165`. From the namespace, both hit the
namespace's own loopback and fail with `ERR_CONNECTION_REFUSED`, so every
UI test run against a local environment failed before its first step.
`pasta -T` binds only `127.0.0.1` in the namespace and accepts no other bind
address, so another loopback alias cannot be forwarded directly. Chromium
resolver rules were rejected: they only see names known in advance, while
these names often come from a local DNS zone.

## Decision

1. The operator names extra host ports in `WHARNEX_UP_LINK_HOST_PORTS`
   (comma-separated, at most 16, typically in the checkout's `.harness/env`).
   They join the gateway port in the `pasta -T` set. With the variable unset
   the namespace exposes exactly what ADR-0072 exposed.
2. Local development names frequently resolve — through `/etc/hosts` or a
   local DNS zone — to loopback aliases such as `127.0.0.165`, which inside
   the namespace are the namespace's own loopback. The namespace root
   therefore installs one nftables NAT rule before Electron starts: TCP to
   `127.0.0.0/8` other than `127.0.0.1`, on the forwarded ports only, is
   redirected to `127.0.0.1`, where pasta carries it to the host. Host header
   and TLS SNI are unchanged, so a host reverse proxy still routes by name.
   Any other port of any alias stays unreachable. If `nft` is unavailable the
   rule is skipped with a warning and only `127.0.0.1` works.
3. Both take effect at Desktop launch; changing them requires restarting the
   Desktop.

## Consequences

- Local UI Lab environments become reachable on the ports the operator named,
  and nothing else of the host loopback is exposed.
- Remote content in the same Chromium process can also reach those named
  ports, as any browser on the host could; the operator's explicit list is the
  boundary. It MUST NOT be widened automatically, and pasta's `-T auto` (every
  bound host port) remains forbidden.
