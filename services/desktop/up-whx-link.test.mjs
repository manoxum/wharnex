import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { UP_LINK_DNS, UP_LINK_ENTER_SCRIPT, UP_LINK_OUTER_SCRIPT, UP_LINK_UNSHARE, prepareUpLink, upLinkCommand, upLinkMode, upLinkPorts, writeUpLinkState } from './up-whx-link.mjs'

const runtimeDir = () => mkdtempSync(path.join(tmpdir(), 'up-whx-link-'))
const gatewayEnv = (extra = {}) => ({
  PATH: process.env.PATH,
  WHARNESS_API_URL: 'http://127.0.0.1:6969',
  WHARNESS_FRONTEND_URL: 'http://127.0.0.1:6969',
  WHARNESS_LINUX_SANDBOX_MODE: 'runtime',
  ...extra,
})
const withTools = (env) => {
  const dir = runtimeDir()
  for (const tool of ['pasta', 'unshare', 'ip', 'mount']) {
    writeFileSync(path.join(dir, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  }
  return { ...env, PATH: dir }
}

test('the up-link is on by default and can be disabled or required', () => {
  assert.equal(upLinkMode({}), 'required')
  assert.equal(upLinkMode({ WHARNESS_UP_LINK: 'auto' }), 'auto')
  assert.equal(upLinkMode({ WHARNESS_UP_LINK: 'off' }), 'off')
  assert.equal(upLinkMode({ WHARNESS_UP_LINK: '0' }), 'off')
  assert.equal(upLinkMode({ WHARNESS_UP_LINK: 'REQUIRED' }), 'required')
})

test('only loopback Desktop endpoints are forwarded, once each', () => {
  assert.deepEqual(upLinkPorts(gatewayEnv()), [6969])
  assert.deepEqual(upLinkPorts({ WHARNESS_API_URL: 'http://127.0.0.1:8888', WHARNESS_FRONTEND_URL: 'http://localhost:5173' }), [5173, 8888])
  assert.deepEqual(upLinkPorts({ WHARNESS_API_URL: 'http://10.0.0.5:8888', WHARNESS_FRONTEND_URL: 'not a url' }), [])
})

test('the launch chain keeps the dedicated helper and gateway positional across both namespace layers', () => {
  const launch = upLinkCommand({ command: '/opt/electron', args: ['.', '--ozone-platform=x11'], ports: [5173, 6969], resolvPath: '/run/r.conf', uid: 1000, gid: 1000, unshareCommand: UP_LINK_UNSHARE, gateway: '192.168.1.1' })
  assert.equal(launch.command, 'sh')
  assert.deepEqual(launch.args, ['-c', UP_LINK_OUTER_SCRIPT, 'up-whx-link', UP_LINK_ENTER_SCRIPT, '/run/r.conf', '1000', '1000', '5173,6969', UP_LINK_DNS, UP_LINK_UNSHARE, '192.168.1.1', '/opt/electron', '.', '--ozone-platform=x11'])
  for (const script of [UP_LINK_OUTER_SCRIPT, UP_LINK_ENTER_SCRIPT]) assert.doesNotMatch(script, /\/opt\/electron|6969|1000|169\.254|192\.168\.1\.1/)
  assert.match(UP_LINK_OUTER_SCRIPT, /"\$h" --user --map-root-user/)
  assert.match(UP_LINK_OUTER_SCRIPT, /"\$h" "\$gw" "\$@"/)
  assert.match(UP_LINK_ENTER_SCRIPT, /r=\$1; u=\$2; g=\$3; h=\$4; gw=\$5; shift 5/)
  assert.match(UP_LINK_ENTER_SCRIPT, /"\$h" --user --map-user="\$u"/)
})

test('a missing on-link route to the gateway is repaired from inside the namespace', () => {
  // pasta's own route copy can fail silently (ENETUNREACH) when the host
  // gateway has no visible connected route (e.g. NetworkManager noprefixroute
  // addresses). The namespace must repair it itself, onlink, using the same
  // gateway the host was using — never by mutating host routing.
  assert.match(UP_LINK_ENTER_SCRIPT, /ip route add default via "\$gw" dev "\$iface" onlink/)
  const wait = UP_LINK_ENTER_SCRIPT.indexOf('while [ -z "$(ip route show default')
  const repair = UP_LINK_ENTER_SCRIPT.indexOf('ip route add default via')
  const check = UP_LINK_ENTER_SCRIPT.indexOf('|| exit 95')
  assert.ok(wait > -1 && wait < repair && repair < check, 'the repair runs inside the wait loop, before the hard failure')
})

test('Electron keeps the host PID namespace and process group', () => {
  // A PID namespace would make Electron PID 1: TERM ignored, orphans unreaped,
  // and a single-instance lock naming a PID the host cannot resolve.
  assert.match(UP_LINK_OUTER_SCRIPT, /"\$h" --user --map-root-user --net --mount --propagation slave -- sh -c "\$inner"/)
  assert.doesNotMatch(UP_LINK_OUTER_SCRIPT, /--pid|--fork|setsid/)
  // pasta is attached only once the namespace really exists, never to the host's.
  const attach = UP_LINK_OUTER_SCRIPT.indexOf('pasta --config-net')
  assert.ok(UP_LINK_OUTER_SCRIPT.indexOf('readlink /proc/$ns/ns/net') < attach)
  assert.match(UP_LINK_OUTER_SCRIPT, /exit 96/)
  assert.match(UP_LINK_OUTER_SCRIPT, /wait "\$ns"; status=\$\?; kill -TERM "\$link"/)
})

test('Electron starts only on a settled namespace, as the real user', () => {
  const route = UP_LINK_ENTER_SCRIPT.indexOf('ip route show default')
  const dad = UP_LINK_ENTER_SCRIPT.indexOf('ip -6 addr show tentative')
  const launch = UP_LINK_ENTER_SCRIPT.indexOf('exec "$h" --user --map-user="$u" --map-group="$g" -- "$@"')
  assert.ok(route > -1 && dad > route && launch > dad)
  assert.match(UP_LINK_ENTER_SCRIPT, /mount --bind "\$r" "\$\(readlink -f \/etc\/resolv\.conf\)"/)
})

test('an active up-link switches the sandbox to user namespaces and writes its resolver', () => {
  const env = withTools(gatewayEnv())
  const dir = runtimeDir()
  const plan = prepareUpLink(env, { runtimeDir: dir, platform: 'linux', preflight: () => {}, uid: 1000, gid: 1000 })
  assert.equal(plan.active, true)
  assert.deepEqual(plan.ports, [6969])
  assert.equal(env.WHARNESS_LINUX_SANDBOX_MODE, 'userns')
  assert.match(readFileSync(plan.resolvPath, 'utf8'), new RegExp(`nameserver ${UP_LINK_DNS.replaceAll('.', '\\.')}`))
  writeUpLinkState(dir, plan)
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'up-whx-link.state'), 'utf8')).active, true)
})

test('auto mode falls back to the ordinary launch and keeps the sandbox untouched', () => {
  const env = withTools(gatewayEnv({ WHARNESS_UP_LINK: 'auto' }))
  const plan = prepareUpLink(env, { runtimeDir: runtimeDir(), platform: 'linux', preflight: () => { throw new Error('userns denied') } })
  assert.equal(plan.active, false)
  assert.match(plan.reason, /preflight failed: userns denied/)
  let attempts = 0
  const retryEnv = withTools(gatewayEnv({ WHARNESS_UP_LINK: 'auto' }))
  const retried = prepareUpLink(retryEnv, { runtimeDir: runtimeDir(), platform: 'linux', preflight: () => { if (++attempts === 1) throw new Error('settling') } })
  assert.equal(retried.active, true, 'one transient preflight failure is retried')
  assert.equal(attempts, 2)
  assert.equal(retryEnv.WHARNESS_LINUX_SANDBOX_MODE, 'userns', 'successful retry keeps the sandbox mode switch')
  assert.equal(env.WHARNESS_LINUX_SANDBOX_MODE, 'runtime')
  // Inject an absent dedicated helper so the assertion stays deterministic
  // even when the execution host has the production helper installed in /opt.
  assert.equal(prepareUpLink(gatewayEnv({ WHARNESS_UP_LINK: 'auto', PATH: '/nonexistent' }), { runtimeDir: runtimeDir(), platform: 'linux', unsharePath: '/nonexistent/wharnex-up-link-unshare' }).reason, 'missing pasta, ip, mount, unshare')
  assert.equal(prepareUpLink(gatewayEnv(), { runtimeDir: runtimeDir(), platform: 'darwin' }).reason, 'unsupported-platform')
  assert.equal(prepareUpLink(gatewayEnv({ WHARNESS_UP_LINK: 'off' }), { runtimeDir: runtimeDir(), platform: 'linux' }).reason, 'disabled')
})

test('required mode refuses to start without the up-link', () => {
  assert.throws(
    () => prepareUpLink(gatewayEnv({ WHARNESS_UP_LINK: 'required', PATH: '/nonexistent' }), { runtimeDir: runtimeDir(), platform: 'linux' }),
    /up-whx-link is required but unavailable: missing pasta/,
  )
})
