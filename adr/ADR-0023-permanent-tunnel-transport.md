# ADR-0023: Permanent tunnel transport with restart rehydration

Status: Accepted — 2026-09-05

## Decision

Consumer ChatGPT communication uses only direct local files or a provider from
the dedicated Tunnel Provider pool. Remote storage drivers remain configurable
but are no longer transport adapters.

Cloudflare Named Tunnel, ngrok Reserved Domain, and an operator-configured
Tailscale Funnel are the permanent provider types. zrok is available as an
additional account-backed ephemeral fallback. Account credentials for token
providers are enrolled into private application storage; the
pool document contains only an opaque credential reference and non-secret public
origin settings. Standalone CLI providers reuse their own local
browser-authenticated state and Wharness neither stores their account secrets
nor mutates shared account/tailnet configuration. TryCloudflare remains an
explicitly ephemeral no-account compatibility provider.

Active channel resources are persisted below Wharness application state. A
normal backend shutdown stops the connector without deleting those resources.
At startup, a permanent provider restores the resources and reconnects the same
configured DNS before accepting requests. Terminal request completion deletes
that request namespace; explicit full-data clearing deletes all namespaces.

The composer bootstrap and channel documents enumerate literal absolute URLs
for every required stable endpoint. Context and attachment aliases are replaced
atomically when generation changes; hash-addressed copies remain available for
audit. The consumer never needs to construct a sibling URL.

Each tunnel document also owns a user-selected public instance name. The root
landing page can list configured permanent origins and emit a QR discovery
record containing only the name and one public origin. This prepares explicit
future Wharness-to-Wharness pairing without making discovery an authentication
or authorization mechanism.

Long-running `thinking` state is not treated as evidence of a stall. Automatic
reload is reserved for a bounded explicit transport failure or a terminal
response without the expected bundle.

## Consequences

- A request can survive backend and tunnel-process restart without changing URL.
- Connector death is detected and the same permanent hostname is reconnected.
- Quick Tunnel requests remain unable to survive a process restart and are
  labelled temporary in settings.
- Existing storage configuration is retained for later non-transport use.

This ADR supersedes ADR-0020 only where that ADR assigns ChatGPT transport to
remote storage providers.
