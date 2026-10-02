# ADR-0072 — up-whx-link: network isolation for Desktop browsers

- Status: accepted
- Date: 2026-09-24

## Context

The embedded ChatGPT views (`WebContentsView`) fail in bursts with
`net::ERR_NETWORK_CHANGED`. On Linux, Chromium's network service watches
netlink address/link/route events for every interface in its network
namespace. Any such event, such as a Docker `veth`/`br-*` appearing when a
container restarts, a NIC, Wi-Fi or VPN switch, or an IPv6 address being
renewed, is treated as a network change. Chromium then closes every socket and
fails in-flight requests, even when the route to `chatgpt.com` never changed.
All ChatGPT views share the network service of the Desktop's Electron process,
so that process is the unit to isolate.

## Decision

On Linux the Desktop's Electron process runs inside its own network namespace,
the **up-whx-link**, connected to the host by `pasta` (passt, unprivileged
userspace networking). Inside the namespace there is only `lo` and one
interface configured once at start. Outbound traffic leaves through ordinary
host sockets owned by `pasta`, so host interface churn never reaches Chromium.
The implementation is `services/desktop/host/up-whx-link.mjs`, called by
`services/desktop/lifecycle/dev.mjs`.

1. The namespaces (user, net and mount) are created with `unshare`. `pasta` is
   then attached to that process's PID. Letting `pasta` start the command
   itself would also create a PID namespace in which Electron becomes PID 1.
   There, SIGTERM without a handler is ignored, orphans are not reaped, and the
   Chromium single-instance lock would record a PID the host cannot resolve.
   Without a PID namespace, Electron stays in the coordinator's process group,
   so `make stop`, `make restart`, `orphan-recovery.sh` and the launcher's
   foreground handoff behave as before.
2. `pasta` runs with `--foreground`. Its default of detaching depends on
   whether a TTY is present, which differs between a terminal and the launcher.
3. The Desktop reaches the host only through the loopback endpoints in
   `WHARNESS_API_URL` and `WHARNESS_FRONTEND_URL` (the gateway). Each of their
   ports is forwarded from the namespace loopback to the host loopback
   (`pasta -T`). Any future host loopback service the Desktop must reach needs
   to be added to that forwarded set.
4. DNS: the host resolver usually lives on loopback (`127.0.0.53`), which is
   unreachable inside the namespace. `pasta --dns-forward 169.254.1.1` relays
   queries to the host resolver, and a private mount namespace binds a
   `resolv.conf` pointing at `169.254.1.1` over the host file. The host's
   `resolv.conf` is not modified.
5. Electron starts only once the namespace has settled: the default route has
   been configured and no IPv6 address is still `tentative`. Otherwise
   `pasta`'s own configuration, or the link-local address finishing duplicate
   detection, would be a netlink change that fails the first page load.
6. Electron runs as the real uid/gid, through a nested user namespace mapping.
   Its sandbox switches from the setuid helper, which cannot gain privileges
   inside a user namespace, to Chromium's namespace sandbox
   (`WHARNESS_LINUX_SANDBOX_MODE=userns`, `--disable-setuid-sandbox`). The
   renderer sandbox stays enabled. `--no-sandbox` is never used.
7. Ubuntu's AppArmor user-namespace restriction denies the namespace root the
   capabilities needed to create the network and mount namespaces when an
   unprofiled Desktop is launched by GNOME. `make build` therefore runs
   `scripts/up-whx-link-host.sh install`. On affected Linux hosts it installs a
   root-owned copy of `unshare` at
   `/opt/wharness/libexec/wharnex-up-link-unshare`, grants execute access only
   to the installing uid, and loads an AppArmor profile attached to that exact
   immutable path with the `userns,` permission. It does not disable the
   system-wide restriction or weaken the profile of `/usr/bin/unshare`.
   The installer also verifies the unprivileged `pasta`, `ip` and `mount` host
   tools before completing a required-mode build. On Debian and Ubuntu 24.04+
   the `passt` package provides `pasta`; a missing package is reported with an
   installation command rather than becoming an unexplained Desktop crash.

`WHARNESS_UP_LINK=required` is the Linux mode. Legacy `auto` and `off` settings
are rejected: a Desktop without the namespace would recreate the reported
network-change failures. The build's host dependency check also rejects those
settings, so an unusable installation fails before launch.

Every HTTP(S) link the Desktop opens externally starts Chrome/Chromium/Brave
directly with a Wharnex-owned per-Desktop profile under
`ManagedBrowser/LinkProfile`. Electron's
`shell.openExternal` is not used for browser URLs because a system URL handler
can hand them to a Chrome instance already running in the host namespace.
The external launcher compares its network namespace to its host-side parent before
spawning and refuses the request if they match. Embedded Supervisor, Worker,
and internal views inherit Electron's namespace; the managed authentication
browser is spawned by Electron and inherits it too. Browser-session clearing
closes the owned link browser and removes its private profile. When `make start`
finds an existing Linux Desktop, it signals that isolated Electron to raise its
window instead of starting a second Electron in the host namespace.

The decision is logged (`[up-whx-link] active|inactive …`), recorded in
`.harness/run/up-whx-link.state`, and shown by `make status`.

### Network faults wait before reloading

The up-link removes the spurious network-change faults. A real transport
failure can still happen, for example a dropped connection or a failed DNS
lookup. Before this decision, a single `net::ERR_*` on the main frame or on the
conversation transport (for example `POST /backend-api/f/conversation/resume`)
reloaded the page immediately. The only limits were a 5 s cooldown and 3
reloads, and every view hit by the same network flap reloaded at once. That
turned a flap into a request burst that ChatGPT answered with HTTP 429.
`services/desktop/chatgpt-transport-backoff.mjs` changes this:

- A network fault first leaves recovery to the page. The reload waits 20 s, then
  60 s, then 180 s, depending on how many transport reloads the request has
  already used. Each new fault restarts the wait.
- A fault is dropped without reloading when the conversation shows progress
  after it.
- Network-fault reloads are spaced by at least 15 s across the whole Desktop.
- Renderer faults (crash, unresponsive, failed DOM probes) keep their immediate
  reload. The bounded escalation to human action is unchanged. It is reached
  only after the waits.

## Consequences

- Host interface churn (container restarts, bridges, interface renaming, IPv6
  address renewals) no longer fails embedded ChatGPT requests.
- A real uplink switch still breaks the TCP connections whose host source
  address disappears. They fail individually and are retried, instead of every
  request failing at once. Surviving that as well would need an exit that
  roams, for example the WireGuard tunnel of ADR-0069. That is not decided here.
- Start-up takes about 1.5 s longer: the preflight, plus waiting for the
  namespace to settle.
- Wharnex-owned external browsers inherit the namespace and use a separate
  profile, so they cannot delegate to a pre-existing host Chrome instance.
- Hosts without `pasta` cannot start the Linux Desktop until it is installed.
- A normal operator `make build` may request privilege once when the scoped
  AppArmor profile/helper is absent or stale. Subsequent builds verify the
  installed bytes and live namespace probe without privilege or mutation.
