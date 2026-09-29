import path from 'node:path'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

// The filename is persisted state and keeps its shipped spelling.
const RESTART_FILENAME = 'wharness-window-restart-intent.json'
const WINDOW_ID = /^[A-Za-z0-9_-]{1,80}$/

export function createDesktopRestartIntent({ userDataPath }) {
  const filename = () => path.join(userDataPath(), RESTART_FILENAME)

  function persist(scope, currentWindowId) {
    try {
      writeFileSync(filename(), JSON.stringify({ version: 1, scope, current_window_id: currentWindowId, created_at: Date.now() }), { mode: 0o600 })
    } catch (error) { console.warn('[windows] restart intent persistence failed', error) }
  }

  function consume() {
    try {
      const saved = filename()
      const parsed = JSON.parse(readFileSync(saved, 'utf8'))
      try { rmSync(saved, { force: true }) } catch { /* best effort */ }
      const scope = parsed?.scope === 'current' ? 'current' : parsed?.scope === 'all' ? 'all' : ''
      const currentWindowId = typeof parsed?.current_window_id === 'string' && WINDOW_ID.test(parsed.current_window_id) ? parsed.current_window_id : ''
      const createdAt = Number(parsed?.created_at || 0)
      if (!scope || !currentWindowId || !Number.isFinite(createdAt) || Date.now() - createdAt > 10 * 60 * 1000) return undefined
      return { scope, currentWindowId }
    } catch { return undefined }
  }

  return { persist, consume }
}
