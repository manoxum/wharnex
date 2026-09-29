import path from 'node:path'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

// The filename is persisted state and keeps its shipped spelling.
const RECOVERY_FILENAME = 'wharness-desktop-recovery-session.json'
const WINDOW_ID = /^[A-Za-z0-9_-]{1,80}$/

function windowSnapshot(windowState) {
  if (!windowState?.window || windowState.window.isDestroyed() || windowState.transientSurface) return undefined
  const projects = [...windowState.projects].filter(Boolean)
  if (!projects.length) return undefined
  return {
    id: windowState.id,
    projects,
    active_project: projects.includes(windowState.activeProject) ? windowState.activeProject : projects[0],
  }
}

export function recoverableDesktopWindows(recovery) {
  if (!recovery?.windows?.length) return [{ id: 'primary', projects: [], activeProject: '' }]
  const records = []
  for (const record of recovery.windows) {
    const projects = [...record.projects]
    if (projects.length) records.push({ id: record.id, projects, activeProject: projects.includes(record.activeProject) ? record.activeProject : projects[0] })
  }
  return records.length ? records : [{ id: 'primary', projects: [], activeProject: '' }]
}

export function createDesktopWindowRecovery({ userDataPath, windows, canonicalProjectPath }) {
  const filename = () => path.join(userDataPath(), RECOVERY_FILENAME)

  function persist() {
    try {
      const snapshots = [...windows.values()].map(windowSnapshot).filter(Boolean)
      if (!snapshots.length) {
        rmSync(filename(), { force: true })
        return false
      }
      writeFileSync(filename(), JSON.stringify({ version: 1, created_at: Date.now(), windows: snapshots }), { mode: 0o600 })
      return true
    } catch (error) {
      console.warn('[windows] recovery session persistence failed', error)
      return false
    }
  }

  function consume() {
    try {
      const saved = filename()
      const parsed = JSON.parse(readFileSync(saved, 'utf8'))
      try { rmSync(saved, { force: true }) } catch { /* best effort */ }
      if (parsed?.version !== 1 || !Array.isArray(parsed.windows)) return undefined
      const recovered = []
      const seenProjects = new Set()
      for (const candidate of parsed.windows.slice(0, 12)) {
        const id = typeof candidate?.id === 'string' && WINDOW_ID.test(candidate.id) ? candidate.id : ''
        if (!id || !Array.isArray(candidate?.projects)) continue
        const projects = []
        for (const value of candidate.projects) {
          try {
            const projectPath = canonicalProjectPath(value)
            if (!seenProjects.has(projectPath)) { seenProjects.add(projectPath); projects.push(projectPath) }
          } catch { /* stale project path */ }
        }
        if (!projects.length) continue
        const activeProject = projects.includes(candidate.active_project) ? candidate.active_project : projects[0]
        recovered.push({ id, projects, activeProject })
      }
      return recovered.length ? { windows: recovered } : undefined
    } catch { return undefined }
  }

  return { persist, consume }
}
