import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export function createDesktopCoordinatorRelaunch({
  root = () => process.env.WHARNESS_ROOT,
  isQuitting, readStatus = readFile, spawnHelper = spawn,
  parentPID = () => process.ppid, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 600,
}) {
  async function waitForSelfEvolutionActivation() {
    const projectRoot = String(root() || '').trim()
    if (!projectRoot) return false
    const statusPath = path.join(projectRoot, '.harness', 'self-evolution', 'status')
    for (let attempt = 0; attempt < attempts && !isQuitting(); attempt += 1) {
      try {
        const status = await readStatus(statusPath, 'utf8')
        const phase = status.split('\n').find((line) => line.startsWith('phase='))?.slice('phase='.length)
        if (phase === 'restarted') return true
        if (phase === 'rolled_back_runtime' || phase === 'rollback_failed' || phase === 'restart_failed') return false
      } catch { /* the detached supervisor has not published status yet */ }
      await wait(500)
    }
    return false
  }

  async function scheduleDesktopCoordinatorRelaunch() {
    const projectRoot = String(root() || '').trim()
    if (!projectRoot) throw new Error('WHARNESS_ROOT is required to relaunch the Desktop coordinator')
    const helper = path.join(projectRoot, 'scripts', 'desktop-relaunch.sh')
    const child = spawnHelper(helper, [projectRoot, String(parentPID())], {
      cwd: projectRoot,
      env: { ...process.env, WHARNESS_ROOT: projectRoot },
      detached: true,
      stdio: 'ignore',
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
  }

  return { waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch }
}
