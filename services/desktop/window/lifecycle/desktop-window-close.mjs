import path from 'node:path'

const CLOSE_ACTIONS = new Set(['background', 'close-window', 'close-all', 'cancel'])
// This bounds how long the renderer may take to acknowledge that it put the
// modal on screen — never how long the person may take to decide. A human
// reading four options routinely needs longer than any timeout worth setting,
// so once the modal is acknowledged the decision waits indefinitely.
const DEFAULT_ACKNOWLEDGE_TIMEOUT_MS = 3_000

function projectFor(windowState) {
  if (windowState.activeProject && windowState.projects.has(windowState.activeProject)) return windowState.activeProject
  return [...windowState.projects][0] || ''
}

function descriptorFor(windowState) {
  const projectPath = projectFor(windowState)
  return { projectPath, projectName: path.basename(projectPath) || projectPath, hasProject: Boolean(projectPath) }
}

export function createDesktopWindowCloseCoordinator({
  publish,
  background,
  closeWindow,
  closeAll,
  fallback,
  acknowledgeTimeoutMs = DEFAULT_ACKNOWLEDGE_TIMEOUT_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  const pending = new WeakMap()

  function settle(windowState) {
    const request = pending.get(windowState)
    if (request?.timer !== undefined) cancel(request.timer)
    pending.delete(windowState)
    return request
  }

  function perform(windowState, request, action) {
    if (action === 'background') background(windowState)
    if (action === 'close-window') closeWindow(windowState)
    if (action === 'close-all') closeAll()
  }

  // The renderer owns the confirmation, so a renderer that never puts the
  // modal up — one still loading, one that crashed, or one running without the
  // privileged bridge — would otherwise leave a window that refuses every
  // close for the rest of the session, reachable only by killing the process.
  // Escalating to the caller's native prompt keeps a way out that needs no
  // renderer at all. A renderer that did present the modal has acknowledged
  // it by now, so this never races the person actually reading it.
  function escalate(windowState) {
    const request = settle(windowState)
    if (!request) return
    const action = fallback ? fallback(windowState, request.descriptor) : 'close-window'
    if (!CLOSE_ACTIONS.has(action)) return
    perform(windowState, request, action)
  }

  return {
    request(windowState, event) {
      if (!windowState || windowState.transientSurface) return false
      event?.preventDefault?.()
      settle(windowState)
      const descriptor = descriptorFor(windowState)
      const request = { projectPath: descriptor.projectPath, descriptor }
      pending.set(windowState, request)
      try {
        publish(windowState, descriptor)
      } catch {
        escalate(windowState)
        return true
      }
      request.timer = schedule(() => escalate(windowState), acknowledgeTimeoutMs)
      return true
    },

    // The renderer reports that the modal is on screen. That disarms the
    // native fallback and hands the decision to the person, for as long as
    // they need it.
    acknowledge(windowState) {
      const request = pending.get(windowState)
      if (!request) return { ok: false, reason: 'not-pending' }
      if (request.timer !== undefined) cancel(request.timer)
      request.timer = undefined
      request.acknowledged = true
      return { ok: true }
    },

    resolve(windowState, action) {
      if (!CLOSE_ACTIONS.has(action)) throw new Error('Ação de fechamento inválida.')
      if (!pending.has(windowState)) return { ok: false, reason: 'not-pending' }
      const request = settle(windowState)
      perform(windowState, request, action)
      return { ok: true, action }
    },

    clear(windowState) {
      settle(windowState)
    },
  }
}
