export function createProjectWindowOwnership({
  registry, windows, canonicalProjectPath, windowTitle, refreshTray,
  trayControl, activeChatGPTEntry, deferredNavigation, reconcileThrottle,
  chatGPTKeyForEntry, hideAgentInteractions,
}) {
  function suspendNativeSurfacesForWindow(windowState) {
    if (!windowState) return false
    windowState.chatgptVisible = false
    windowState.desiredVisibleChatGPTKey = ''
    const pending = deferredNavigation()
    if (pending?.windowState === windowState) pending.visible = false
    const active = activeChatGPTEntry(windowState)
    if (active && !active.view.webContents.isDestroyed()) {
      active.view.setVisible(false)
      reconcileThrottle(chatGPTKeyForEntry(active), active)
    }
    hideAgentInteractions(windowState)
    return true
  }

  function acquireProjectForWindow(windowState, value) {
    const lock = registry.acquire(windowState.id, value)
    if (!lock.ok) {
      const owner = windows.get(lock.ownerWindowId)
      if (owner?.window && !owner.window.isDestroyed()) { owner.window.show(); owner.window.focus() }
      return { ...lock, message: 'Este projeto já está aberto noutra janela do Wharnex. A janela proprietária foi trazida para a frente.' }
    }
    windowState.projects.add(lock.path)
    windowState.activeProject = lock.path
    windowState.window.setTitle(windowTitle(lock.path))
    refreshTray()
    return lock
  }

  function releaseProjectForWindow(windowState, value) {
    const requested = canonicalProjectPath(value)
    if (windowState.activeProject === requested) suspendNativeSurfacesForWindow(windowState)
    const result = registry.release(windowState.id, value)
    if (result.released) {
      windowState.projects.delete(result.path)
      trayControl()?.forgetProject(result.path)
      if (windowState.activeProject === result.path) {
        windowState.activeProject = [...windowState.projects][0] || ''
        windowState.window.setTitle(windowTitle(windowState.activeProject))
      }
    }
    refreshTray()
    return result
  }

  function releaseWindowProjects(windowState) {
    registry.releaseWindow(windowState.id)
    for (const projectPath of windowState.projects) trayControl()?.forgetProject(projectPath)
    windowState.projects.clear()
    windowState.activeProject = ''
    refreshTray()
  }

  return { acquireProjectForWindow, suspendNativeSurfacesForWindow, releaseProjectForWindow, releaseWindowProjects }
}
