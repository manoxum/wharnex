// up-whx-link: runs the Desktop's Electron process inside its own network
// namespace (pasta/passt, unprivileged) so host interface churn never reaches
// Chromium's network-change notifier. Without it every address/link change on
// the host aborts in-flight ChatGPT requests with net::ERR_NETWORK_CHANGED.
// See adr/ADR-0072-up-whx-link-network-isolation.md.

import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const UP_LINK_DNS = '169.254.1.1'
export const UP_LINK_UNSHARE = '/opt/wharness/libexec/wharnex-up-link-unshare'
const REQUIRED_TOOLS = ['pasta', 'ip', 'mount']
const PREFLIGHT_TIMEOUT_MS = 15_000
const PREFLIGHT_ATTEMPTS = 2

// The namespaces are created by `unshare` rather than by pasta itself, because
// pasta would also start a new PID namespace in which Electron becomes PID 1:
// SIGTERM without a handler is then ignored, orphans are not reaped, and the
// Chromium single-instance lock records a PID the host cannot resolve. Without
// a PID namespace every process stays in the coordinator's process group, so
// the existing stop/orphan-recovery signals keep reaching Electron.
//
// OUTER runs on the host: it creates the user/net/mount namespaces, waits
// until they really exist, attaches pasta to them and returns Electron's exit
// status. Every value is positional, never interpolated into a script.
export const UP_LINK_OUTER_SCRIPT = [
  'inner=$1; r=$2; u=$3; g=$4; p=$5; d=$6; h=$7; shift 7',
  '"$h" --user --map-root-user --net --mount --propagation slave -- sh -c "$inner" up-whx-link-ns "$r" "$u" "$g" "$h" "$@" &',
  'ns=$!; host=$(readlink /proc/self/ns/net); i=0',
  'while [ "$(readlink /proc/$ns/ns/net 2>/dev/null)" = "$host" ] && [ "$i" -lt 100 ]; do sleep 0.02; i=$((i+1)); done',
  'if [ "$(readlink /proc/$ns/ns/net 2>/dev/null)" = "$host" ]; then kill -KILL "$ns" 2>/dev/null; exit 96; fi',
  'if [ -n "$p" ]; then pasta --config-net --foreground --quiet -T "$p" --dns-forward "$d" "$ns" & else pasta --config-net --foreground --quiet --dns-forward "$d" "$ns" & fi',
  'link=$!; wait "$ns"; status=$?; kill -TERM "$link" 2>/dev/null; exit "$status"',
].join('\n')

// INNER runs as namespace root. It waits for pasta's configuration and for
// the IPv6 link-local address to finish duplicate detection (itself a netlink
// change that would fail the first page load), points DNS at pasta, then drops
// back to the real uid/gid because Chromium refuses to run as root with its
// sandbox enabled.
export const UP_LINK_ENTER_SCRIPT = [
  'r=$1; u=$2; g=$3; h=$4; shift 4; i=0',
  'while [ -z "$(ip route show default 2>/dev/null)" ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i+1)); done',
  '[ -n "$(ip route show default 2>/dev/null)" ] || exit 95',
  'i=0; while [ -n "$(ip -6 addr show tentative 2>/dev/null)" ] && [ "$i" -lt 30 ]; do sleep 0.1; i=$((i+1)); done',
  'mount --bind "$r" "$(readlink -f /etc/resolv.conf)" || exit 97',
  'exec "$h" --user --map-user="$u" --map-group="$g" -- "$@"',
].join('\n')

export function upLinkMode(env = process.env) {
  const value = String(env.WHARNESS_UP_LINK || '').trim().toLowerCase()
  if (['off', '0', 'false', 'disabled'].includes(value)) return 'off'
  if (value === 'auto') return 'auto'
  if (value === 'required') return 'required'
  return 'required'
}

// The Desktop reaches the host only through these loopback endpoints; each
// port is forwarded from the namespace loopback to the host loopback.
export function upLinkPorts(env = process.env) {
  const ports = new Set()
  for (const key of ['WHARNESS_API_URL', 'WHARNESS_FRONTEND_URL']) {
    try {
      const url = new URL(String(env[key] || ''))
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) continue
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
      if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port)
    } catch { /* not a URL: nothing to forward */ }
  }
  return [...ports].sort((a, b) => a - b)
}

export function upLinkCommand({ command, args = [], ports = [], resolvPath, uid, gid, unshareCommand = 'unshare' }) {
  return {
    command: 'sh',
    args: ['-c', UP_LINK_OUTER_SCRIPT, 'up-whx-link', UP_LINK_ENTER_SCRIPT, resolvPath, String(uid), String(gid), ports.join(','), UP_LINK_DNS, unshareCommand, command, ...args],
  }
}

function onPath(tool, env) {
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    try { accessSync(path.join(dir, tool), constants.X_OK); return true } catch { /* keep looking */ }
  }
  return false
}

function upLinkUnshare(env, unsharePath) {
  const configured = String(env.WHARNESS_UP_LINK_UNSHARE || '').trim()
  if (configured) return configured
  try { accessSync(unsharePath, constants.X_OK); return unsharePath } catch { return 'unshare' }
}

function executable(command, env) {
  if (path.isAbsolute(command)) {
    try { accessSync(command, constants.X_OK); return true } catch { return false }
  }
  return onPath(command, env)
}

function defaultPreflight(plan, env) {
  const probe = upLinkCommand({ command: 'true', ports: plan.ports, resolvPath: plan.resolvPath, uid: plan.uid, gid: plan.gid, unshareCommand: plan.unshareCommand })
  try {
    execFileSync(probe.command, probe.args, { env, stdio: ['ignore', 'ignore', 'pipe'], timeout: PREFLIGHT_TIMEOUT_MS })
  } catch (error) {
    const detail = String(error?.stderr || '').trim().split('\n').filter((line) => !/No routable interface for IPv6/.test(line)).pop() || ''
    throw new Error(`${error?.signal ? `signal ${error.signal}` : `exit ${error?.status ?? '?'}`}${detail ? ` (${detail})` : ''}`)
  }
}

// Decides whether the Desktop launches through the up-link. When it does, the
// Linux sandbox mode is switched to user namespaces in `env`: a setuid helper
// cannot gain privileges inside a user namespace.
export function prepareUpLink(env, { runtimeDir, platform = process.platform, preflight = defaultPreflight, uid = process.getuid?.(), gid = process.getgid?.(), unsharePath = UP_LINK_UNSHARE } = {}) {
  const mode = upLinkMode(env)
  const inactive = (reason) => {
    if (mode === 'required' && reason !== 'disabled') throw new Error(`up-whx-link is required but unavailable: ${reason}`)
    return { active: false, mode, reason }
  }
  if (mode === 'off') return inactive('disabled')
  if (platform !== 'linux') return { active: false, mode, reason: 'unsupported-platform' }
  const missing = REQUIRED_TOOLS.filter((tool) => !onPath(tool, env))
  const unshareCommand = upLinkUnshare(env, unsharePath)
  if (!executable(unshareCommand, env)) missing.push(unshareCommand)
  if (missing.length) return inactive(`missing ${missing.join(', ')}`)
  const ports = upLinkPorts(env)
  if (!ports.length) return inactive('no loopback endpoint to forward')
  mkdirSync(runtimeDir, { recursive: true })
  const resolvPath = path.join(runtimeDir, 'up-whx-link.resolv.conf')
  writeFileSync(resolvPath, `nameserver ${UP_LINK_DNS}\noptions edns0 trust-ad\n`, { mode: 0o644 })
  const plan = { active: true, mode, reason: '', ports, resolvPath, uid, gid, unshareCommand }
  // The launch often follows a stack (re)start whose host network is still
  // settling, so one transient failure is retried before giving up.
  for (let attempt = 1; attempt <= PREFLIGHT_ATTEMPTS; attempt++) {
    try {
      preflight(plan, env)
      break
    } catch (error) {
      if (attempt < PREFLIGHT_ATTEMPTS) continue
      return inactive(`preflight failed: ${String(error?.message || error).split('\n')[0]}`)
    }
  }
  env.WHARNESS_LINUX_SANDBOX_MODE = 'userns'
  return plan
}

export function writeUpLinkState(runtimeDir, plan) {
  const state = { active: plan.active, mode: plan.mode, reason: plan.reason || '', ports: plan.ports || [], at: new Date().toISOString() }
  writeFileSync(path.join(runtimeDir, 'up-whx-link.state'), `${JSON.stringify(state)}\n`, { mode: 0o600 })
}

// Launch-time entry point: decides, records and reports the up-link.
export function startUpLink(env, runtimeDir) {
  const plan = prepareUpLink(env, { runtimeDir })
  writeUpLinkState(runtimeDir, plan)
  console.log(`[up-whx-link] ${plan.active ? `active ports=${plan.ports.join(',')}` : `inactive reason=${plan.reason}`}`)
  return plan
}

export function upLinkTarget(plan, command, args) {
  return plan.active ? upLinkCommand({ ...plan, command, args }) : { command, args }
}
