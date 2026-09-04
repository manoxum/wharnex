import { realpathSync } from 'node:fs'
import path from 'node:path'

export function canonicalProjectPath(value) {
  const raw = String(value || '').trim()
  if (!raw || !path.isAbsolute(raw)) throw new Error('Project path must be absolute')
  const resolved = path.resolve(raw)
  try { return realpathSync.native(resolved) } catch { return resolved }
}

export class ProjectWindowRegistry {
  constructor() { this.owners = new Map() }

  acquire(windowId, value) {
    const projectPath = canonicalProjectPath(value)
    const ownerWindowId = this.owners.get(projectPath)
    if (ownerWindowId && ownerWindowId !== windowId) return { ok: false, path: projectPath, ownerWindowId }
    this.owners.set(projectPath, windowId)
    return { ok: true, path: projectPath, ownerWindowId: windowId }
  }

  release(windowId, value) {
    const projectPath = canonicalProjectPath(value)
    if (this.owners.get(projectPath) !== windowId) return { ok: true, released: false, path: projectPath }
    this.owners.delete(projectPath)
    return { ok: true, released: true, path: projectPath }
  }

  releaseWindow(windowId) {
    const released = []
    for (const [projectPath, ownerWindowId] of this.owners) {
      if (ownerWindowId !== windowId) continue
      this.owners.delete(projectPath)
      released.push(projectPath)
    }
    return released
  }
}
