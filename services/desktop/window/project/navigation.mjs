import path from 'node:path'

export function createDesktopProjectNavigation({ windows, sendToWindowState, createWindow, setMainWindow }) {
  function projectMenuLabel(projectPath) {
    const basename = path.basename(projectPath) || projectPath
    const duplicates = [...windows.values()].flatMap((state) => [...state.projects]).filter((candidate) => path.basename(candidate) === basename)
    return duplicates.length > 1 ? `${basename} · ${projectPath}` : basename
  }

  function projectWindowState(projectPath) {
    return [...windows.values()].find((state) => state.projects.has(projectPath) && state.window && !state.window.isDestroyed())
  }

  function restoreProjectWindow(projectPath) {
    const state = projectWindowState(projectPath)
    if (!state) return false
    if (state.window.isMinimized()) state.window.restore()
    state.window.show()
    state.window.focus()
    setMainWindow(state.window)
    sendToWindowState(state, 'wharness:windows:activate-project', { projectPath })
    return true
  }

  function requestProjectClose(projectPath) {
    const state = projectWindowState(projectPath)
    if (!state) return false
    sendToWindowState(state, 'wharness:windows:close-project', { projectPath })
    return true
  }

  function activeDesktopProjects() {
    return [...new Set([...windows.values()].flatMap((state) => [...state.projects]))]
  }

  function showDesktopFallbackWindow() {
    const state = [...windows.values()].find((candidate) => !candidate.window.isDestroyed() && !candidate.transientSurface)
    if (state) { state.window.show(); state.window.focus(); return true }
    const created = createWindow('primary')
    created.window.show(); created.window.focus()
    return true
  }

  function sendDesktopTrayProjectAction(projectPath, action) {
    const state = projectWindowState(projectPath)
    if (!state) return false
    restoreProjectWindow(projectPath)
    sendToWindowState(state, 'wharness:tray:action', { projectPath, action })
    return true
  }

  return {
    projectMenuLabel, projectWindowState, restoreProjectWindow, requestProjectClose,
    activeDesktopProjects, showDesktopFallbackWindow, sendDesktopTrayProjectAction,
  }
}
