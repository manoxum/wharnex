export function createWorkspaceSurfaceRouting({ canonicalProjectPath, windows, getFocusedWindow }) {
  function normalizedWorkspaceSurface(request) {
    const projectPath = canonicalProjectPath(request?.projectPath)
    const kind = request?.kind === 'chat' || request?.kind === 'editor' || request?.kind === 'terminal' ? request.kind : ''
    if (!kind) throw new Error('Tipo de superfície inválido.')
    const chatId = typeof request?.chatId === 'string' ? request.chatId.trim().slice(0, 200) : ''
    const filePath = typeof request?.path === 'string' ? request.path.trim().replace(/^\/+/, '').slice(0, 4096) : ''
    if (kind === 'chat' && !chatId) throw new Error('Chat inválido para mover entre janelas.')
    if (kind === 'editor' && !filePath) throw new Error('Ficheiro inválido para mover entre janelas.')
    return { projectPath, kind, ...(chatId ? { chatId } : {}), ...(filePath ? { path: filePath } : {}) }
  }

  function desktopWindowAtScreenPoint(point, excludeWindowId = '') {
    const x = Number(point?.x)
    const y = Number(point?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    const focused = getFocusedWindow()
    const candidates = [...windows.values()]
      .filter((state) => state.id !== excludeWindowId && state.window && !state.window.isDestroyed())
      .sort((left, right) => Number(right.window === focused) - Number(left.window === focused))
    return candidates.find((state) => {
      try {
        const bounds = state.window.getBounds()
        return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height
      } catch { return false }
    })
  }

  return { normalizedWorkspaceSurface, desktopWindowAtScreenPoint }
}
