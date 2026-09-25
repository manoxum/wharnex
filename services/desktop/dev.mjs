import electronPath from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronChildEnvironment, electronLaunchArguments, resolveElectronBinary } from './electron-launch.mjs'
import { startUpLink, upLinkTarget } from './up-whx-link.mjs'
import { startHostGitBridge, waitForUnixSocket } from './host-git-bridge.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../..')
const backendDir = path.resolve(here, '../backend')
const frontendDir = path.resolve(here, '../frontend')
const runtimeDir = path.resolve(process.env.WHARNESS_RUNTIME_DIR || path.join(projectRoot, '.harness/run'))
const backendBinary = path.resolve(projectRoot, 'dist/bin/wharness-backend')
const hostTerminalSocket = path.resolve(projectRoot, '.harness/bridge/terminal.sock')
const children = new Map()
const servicesMode = process.env.WHARNESS_SERVICES_MODE || 'local'
// Two checkouts running concurrently each pin their own backend/frontend
// ports (see scripts/start.sh); default to 8888/5173 for a
// bare `npm run dev` invocation outside that wrapper.
const apiURL = process.env.WHARNESS_API_URL || 'http://127.0.0.1:8888'
const frontendURL = process.env.WHARNESS_FRONTEND_URL || 'http://127.0.0.1:5173'
let shuttingDown = false
// A detached Electron child does not reliably keep Node's event loop alive on
// every Linux launcher/runtime combination. The coordinator must remain the
// tracked owner so `make status` and `make stop` do not degrade into orphan
// recovery while Electron is healthy.
const coordinatorKeepAlive = setInterval(() => {}, 60_000)

function desktopRuntimeEnvironment() {
  const env = { ...process.env }
  if (process.platform !== 'linux') return env
  if (env.WHARNESS_LINUX_SANDBOX_MODE && env.WHARNESS_ELECTRON_BINARY) return env
  const manager = path.join(projectRoot, 'scripts/electron-runtime.sh')
  const options = {
    cwd: projectRoot,
    env: { ...env, WHARNESS_ROOT: projectRoot },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }
  env.WHARNESS_LINUX_SANDBOX_MODE = execFileSync(manager, ['mode'], options).trim()
  env.WHARNESS_ELECTRON_BINARY = execFileSync(manager, ['path'], options).trim()
  return env
}

mkdirSync(runtimeDir, { recursive: true })
writePid('coordinator', process.pid)

function pidFile(label) {
  return path.join(runtimeDir, `${label}.pid`)
}

function writePid(label, pid) {
  writeFileSync(pidFile(label), `${pid}\n`, { mode: 0o600 })
}

function clearPid(label) {
  rmSync(pidFile(label), { force: true })
}

function run(label, command, args, cwd, env = {}) {
  const detached = process.platform !== 'win32'
  const childEnvironment = { ...process.env, ...env }
  const child = spawn(command, args, {
    cwd,
    env: label === 'electron' ? electronChildEnvironment(childEnvironment) : childEnvironment,
    stdio: 'inherit',
    detached,
  })
  children.set(label, child)
  writePid(label, child.pid)
  child.on('error', (error) => {
    console.error(`${label} failed to start:`, error)
  })
  child.on('exit', (code, signal) => {
    children.delete(label)
    clearPid(label)
    if (!shuttingDown && (code !== 0 || signal)) console.error(`${label} exited with ${code ?? 'no code'}${signal ? ` (${signal})` : ''}`)
  })
  return child
}

function terminateChild(child, signal) {
  if (!child?.pid || child.killed) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') console.error(`failed to ${signal} pid ${child.pid}:`, error)
  }
}

async function ready(url) {
  try { const response = await fetch(url); return response.ok } catch { return false }
}

async function waitFor(url, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await ready(url)) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`${label} did not become ready: ${url}`)
}

function backendCommand() {
  if (existsSync(backendBinary)) return { command: backendBinary, args: [] }
  return { command: 'go', args: ['run', './cmd/harness'] }
}

function frontendCommand() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const productionBuild = existsSync(path.join(frontendDir, 'dist/index.html'))
  const forceDev = process.env.WHARNESS_FRONTEND_MODE === 'dev'
  return { command: npm, args: ['run', productionBuild && !forceDev ? 'preview' : 'dev'] }
}

async function main() {
  if (servicesMode === 'stack') {
    const hostGit = startHostGitBridge(projectRoot, run)
    hostGit.child.on('exit', (code) => {
      if (!shuttingDown) shutdown(code || 1)
    })
    await Promise.all([
      waitFor(`${apiURL}/api/health`, 'stack backend'),
      waitFor(frontendURL, 'stack frontend'),
      waitForUnixSocket(hostGit.socketPath, 'host Git bridge'),
      waitForUnixSocket(hostTerminalSocket, 'host terminal bridge'),
    ])
  } else {
    if (await ready(`${apiURL}/api/health`)) throw new Error(`An untracked process already owns Wharnex backend ${apiURL}. Stop that verified Wharnex process before starting.`)
    if (await ready(frontendURL)) throw new Error(`An untracked process already owns Wharnex frontend ${frontendURL}. Stop that verified Wharnex process before starting.`)

    const backend = backendCommand()
    run('backend', backend.command, backend.args, backendDir, {
      HARNESS_RUNNER_IMAGE: process.env.WHARNESS_RUNNER_IMAGE || process.env.HARNESS_RUNNER_IMAGE || 'kernl-runner:local',
    })
    const frontend = frontendCommand()
    run('frontend', frontend.command, frontend.args, frontendDir)

    await Promise.all([
      waitFor('http://127.0.0.1:8888/api/health', 'backend'),
      waitFor('http://127.0.0.1:5173', 'frontend'),
    ])
  }

  const desktopEnv = desktopRuntimeEnvironment()
  const upLink = startUpLink(desktopEnv, runtimeDir)
  const launch = electronLaunchArguments(process.platform, desktopEnv)
  // Electron's default userData directory is derived only from package.json's
  // `name`, so two checkouts of this repo collide on the same profile unless
  // one opts into its own via this native Electron/Chromium switch.
  if (desktopEnv.WHARNESS_DESKTOP_USER_DATA_DIR) launch.args.push(`--user-data-dir=${desktopEnv.WHARNESS_DESKTOP_USER_DATA_DIR}`)
  const desktopBinary = resolveElectronBinary(electronPath, desktopEnv)
  if (process.platform === 'linux') {
    console.log(`Electron Linux sandbox: mode=${desktopEnv.WHARNESS_LINUX_SANDBOX_MODE || 'default'}`)
    console.log(`Electron Linux runtime: ${desktopBinary}`)
  }
  if (launch.ozone) console.log(`Electron Linux graphics: ozone=${launch.ozone}`)
  const target = upLinkTarget(upLink, desktopBinary, launch.args)
  const desktop = run('electron', target.command, target.args, here, desktopEnv)
  desktop.on('exit', (code) => {
    if (!shuttingDown) shutdown(code || 0)
  })
}

function cleanupPidFiles() {
  clearPid('backend')
  clearPid('frontend')
  clearPid('electron')
  clearPid('hostpty')
  clearPid('coordinator')
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(coordinatorKeepAlive)
  for (const child of children.values()) terminateChild(child, 'SIGTERM')
  setTimeout(() => {
    for (const child of children.values()) terminateChild(child, 'SIGKILL')
    cleanupPidFiles()
    process.exit(exitCode)
  }, 1200)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('SIGHUP', () => shutdown(0))
process.on('exit', () => clearPid('coordinator'))

main().catch((error) => {
  console.error(error)
  shutdown(1)
})
