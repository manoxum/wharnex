import path from 'node:path'

const CLOSE_ACTIONS = new Set(['background', 'close-project', 'close-all', 'cancel'])

function projectFor(windowState) {
  if (windowState.activeProject && windowState.projects.has(windowState.activeProject)) return windowState.activeProject
  return [...windowState.projects][0] || ''
}

export function createDesktopWindowCloseCoordinator({ publish, background, closeProject, closeWindow, closeAll }) {
  const pending = new WeakMap()

  return {
    request(windowState, event) {
      if (!windowState || windowState.transientSurface) return false
      event?.preventDefault?.()
      const projectPath = projectFor(windowState)
      pending.set(windowState, { projectPath })
      publish(windowState, {
        projectPath,
        projectName: path.basename(projectPath) || projectPath,
        hasProject: Boolean(projectPath),
      })
      return true
    },

    resolve(windowState, action) {
      if (!CLOSE_ACTIONS.has(action)) throw new Error('Ação de fechamento inválida.')
      const request = pending.get(windowState)
      if (!request) return { ok: false, reason: 'not-pending' }
      pending.delete(windowState)

      if (action === 'background') background(windowState)
      if (action === 'close-project') {
        if (request.projectPath) closeProject(request.projectPath)
        else closeWindow(windowState)
      }
      if (action === 'close-all') closeAll()
      return { ok: true, action }
    },

    clear(windowState) {
      pending.delete(windowState)
    },
  }
}
