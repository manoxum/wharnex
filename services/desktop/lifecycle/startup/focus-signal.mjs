import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function registerDesktopFocusSignal({ processTarget, runtimeDir, showDesktop }) {
  if (!runtimeDir || !Number.isInteger(processTarget.pid)) return
  const pidPath = path.join(runtimeDir, 'electron-main.pid')
  const pid = String(processTarget.pid)
  processTarget.on('SIGUSR1', showDesktop)
  writeFileSync(pidPath, `${pid}\n`, { mode: 0o600 })
  processTarget.once('exit', () => {
    try {
      if (readFileSync(pidPath, 'utf8').trim() === pid) rmSync(pidPath, { force: true })
    } catch { /* another shutdown path may have removed the file */ }
  })
}
