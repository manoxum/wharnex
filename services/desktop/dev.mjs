import electronPath from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronChildEnvironment, electronLaunchArguments, resolveElectronBinary } from './electron-launch.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../..')
const backendDir = path.resolve(here, '../backend')
const frontendDir = path.resolve(here, '../frontend')
const runtimeDir = path.resolve(process.env.WHARNESS_RUNTIME_DIR || path.join(projectRoot, '.harness/run'))
const backendBinary = path.resolve(projectRoot, 'dist/bin/wharness-backend')
const children = new Map()
let shuttingDown = false

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
  child.on('exit', (code, signal) => {
    children.delete(label)
    clearPid(label)
    if (!shuttingDown && code && code !== 0) console.error(`${label} exited with ${code}${signal ? ` (${signal})` : ''}`)
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
  if (!await ready('http://127.0.0.1:8080/api/health')) {
    const backend = backendCommand()
    run('backend', backend.command, backend.args, backendDir, {
      HARNESS_RUNNER_IMAGE: process.env.WHARNESS_RUNNER_IMAGE || process.env.HARNESS_RUNNER_IMAGE || 'kernl-runner:local',
    })
  } else {
    console.log('Reusing existing backend on 127.0.0.1:8080')
  }

  if (!await ready('http://127.0.0.1:5173')) {
    const frontend = frontendCommand()
    run('frontend', frontend.command, frontend.args, frontendDir)
  } else {
    console.log('Reusing existing frontend on 127.0.0.1:5173')
  }

  await Promise.all([
    waitFor('http://127.0.0.1:8080/api/health', 'backend'),
    waitFor('http://127.0.0.1:5173', 'frontend'),
  ])

  const desktopEnv = desktopRuntimeEnvironment()
  const launch = electronLaunchArguments(process.platform, desktopEnv)
  const desktopBinary = resolveElectronBinary(electronPath, desktopEnv)
  if (process.platform === 'linux') {
    console.log(`Electron Linux sandbox: mode=${desktopEnv.WHARNESS_LINUX_SANDBOX_MODE || 'default'}`)
    console.log(`Electron Linux runtime: ${desktopBinary}`)
  }
  if (launch.ozone) console.log(`Electron Linux graphics: ozone=${launch.ozone}`)
  const desktop = run('electron', desktopBinary, launch.args, here, desktopEnv)
  desktop.on('exit', (code) => {
    if (!shuttingDown) shutdown(code || 0)
  })
}

function cleanupPidFiles() {
  clearPid('backend')
  clearPid('frontend')
  clearPid('electron')
  clearPid('coordinator')
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
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
