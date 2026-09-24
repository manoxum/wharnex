export { rememberOpenedProject, syncOpenedProjectHistory } from './projectHistory'
const BOUND_PREFIX = 'kernl.workspace.bound-projects.v1:'
const ACTIVE_PREFIX = 'kernl.workspace.bound-active.v1:'

export function desktopWindowScope() {
  try { return new URLSearchParams(window.location.search).get('wharnessWindow') || 'web' } catch { return 'web' }
}

export function embeddedProjectPath() {
  try {
    if (new URLSearchParams(window.location.search).get('embedded') !== '1') return ''
    return new URLSearchParams(window.location.search).get('project') || ''
  } catch { return '' }
}

export function embeddedProjectInitiallyActive() {
  try { return new URLSearchParams(window.location.search).get('active') === '1' } catch { return true }
}

export function loadBoundProjects(): string[] {
  try {
    const raw = localStorage.getItem(BOUND_PREFIX + desktopWindowScope())
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))].slice(0, 12)
  } catch { return [] }
}

export function saveBoundProjects(paths: string[]) {
  const normalized = [...new Set(paths.map((item) => item.trim()).filter(Boolean))].slice(0, 12)
  try { localStorage.setItem(BOUND_PREFIX + desktopWindowScope(), JSON.stringify(normalized)) } catch { /* best effort */ }
}

export function loadBoundActiveProject() {
  try { return localStorage.getItem(ACTIVE_PREFIX + desktopWindowScope()) || '' } catch { return '' }
}

export function saveBoundActiveProject(projectPath: string) {
  try {
    if (projectPath) localStorage.setItem(ACTIVE_PREFIX + desktopWindowScope(), projectPath)
    else localStorage.removeItem(ACTIVE_PREFIX + desktopWindowScope())
  } catch { /* best effort */ }
}
