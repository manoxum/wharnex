import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'

export function startHostGitBridge(projectRoot, run) {
  const binaryPath = path.resolve(projectRoot, 'dist/bin/wharnex-host-pty')
  const socketPath = path.resolve(projectRoot, '.harness/bridge/host-git.sock')
  if (!existsSync(binaryPath)) throw new Error(`Host Git bridge is missing: ${binaryPath}. Run make build.`)
  const child = run('hostpty', binaryPath, ['--git-socket', socketPath], projectRoot, {
    // Desktop launchers may omit HOME; Git and gh still need the host user's
    // configuration directory to resolve their existing credential helpers.
    HOME: process.env.HOME || homedir(),
    HARNESS_HOST_GIT_SOCKET: socketPath,
  })
  return { child, socketPath }
}

export async function waitForUnixSocket(socketPath, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection(socketPath)
      socket.once('connect', () => { socket.end(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (connected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} did not become ready: ${socketPath}`)
}
