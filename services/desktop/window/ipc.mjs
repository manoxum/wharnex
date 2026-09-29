import { BrowserWindow, dialog, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { canonicalProjectPath } from '../project-window-registry.mjs'
import { desktopWindowTitle } from '../desktop-identity.mjs'

export function registerWindowIPC({
  ipcMain, trustedSender, desktopWindows, acquireProjectForWindow,
  releaseProjectForWindow, suspendNativeSurfacesForWindow, createWindow,
  normalizedWorkspaceSurface, desktopWindowAtScreenPoint, sendToWindowState,
  desktopWindowClose, DESKTOP_INSTANCE,
}) {
  ipcMain.handle('wharness:projects:pick-directory', async (event, request) => {
    const windowState = trustedSender(event)
    const requestedDefaultPath = typeof request?.defaultPath === 'string' && path.isAbsolute(request.defaultPath) ? request.defaultPath : undefined
    const result = await dialog.showOpenDialog(windowState.window, {
      title: typeof request?.title === 'string' ? request.title.slice(0, 120) : 'Selecionar pasta',
      defaultPath: requestedDefaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    return { cancelled: result.canceled || result.filePaths.length === 0, path: result.filePaths[0] || '' }
  })
  ipcMain.handle('wharness:projects:pick-image', async (event, request) => {
    const windowState = trustedSender(event)
    const result = await dialog.showOpenDialog(windowState.window, {
      title: typeof request?.title === 'string' && request.title.trim() ? request.title.trim() : 'Selecionar logo do projeto',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
    })
    const selected = result.canceled ? '' : result.filePaths[0] || ''
    if (!selected) return { cancelled: true, dataURL: '' }
    const extension = path.extname(selected).toLowerCase()
    const mime = extension === '.svg' ? 'image/svg+xml' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : 'image/png'
    const payload = await readFile(selected)
    if (payload.byteLength > 2 * 1024 * 1024) throw new Error('O logotipo deve ter no máximo 2 MiB.')
    return { cancelled: false, dataURL: `data:${mime};base64,${payload.toString('base64')}` }
  })
  ipcMain.handle('wharness:projects:trash', async (event, request) => {
    trustedSender(event)
    const projectPath = canonicalProjectPath(request?.projectPath)
    const owner = [...desktopWindows.values()].find((state) => !state.window.isDestroyed() && !state.transientSurface && state.projects.has(projectPath))
    if (owner) throw new Error('Feche ou desvincule o projeto antes de o mover para o lixo.')
    await shell.trashItem(projectPath)
    return { ok: true, path: projectPath }
  })
  ipcMain.handle('wharness:projects:acquire', (event, request) => acquireProjectForWindow(trustedSender(event), request?.projectPath))
  ipcMain.handle('wharness:projects:release', (event, request) => releaseProjectForWindow(trustedSender(event), request?.projectPath))
  ipcMain.handle('wharness:projects:activate', (event, request) => {
    const windowState = trustedSender(event)
    const projectPath = canonicalProjectPath(request?.projectPath)
    if (!windowState.projects.has(projectPath)) throw new Error('Projeto ativo não pertence a esta janela')
    if (windowState.activeProject && windowState.activeProject !== projectPath) suspendNativeSurfacesForWindow(windowState)
    windowState.activeProject = projectPath
    windowState.window.setTitle(desktopWindowTitle(projectPath, DESKTOP_INSTANCE))
    return { ok: true, path: projectPath }
  })
  ipcMain.handle('wharness:projects:bindings', (event) => {
    const windowState = trustedSender(event)
    return { windowId: windowState.id, projects: [...windowState.projects] }
  })
  ipcMain.handle('wharness:windows:info', (event) => {
    const windowState = trustedSender(event)
    return { windowId: windowState.id, windowCount: desktopWindows.size }
  })
  ipcMain.handle('wharness:windows:recovery', (event) => {
    const windowState = trustedSender(event)
    return {
      active: Boolean(windowState.recovery?.active),
      projects: Array.isArray(windowState.recovery?.projects) ? [...windowState.recovery.projects] : [],
      activeProject: String(windowState.recovery?.activeProject || ''),
      pending: Boolean(windowState.recovery?.pending),
    }
  })
  ipcMain.handle('wharness:windows:projects', (event) => {
    const current = trustedSender(event)
    const focused = BrowserWindow.getFocusedWindow()
    const items = []
    for (const state of desktopWindows.values()) {
      if (state.window.isDestroyed() || state.transientSurface) continue
      for (const projectPath of state.projects) items.push({ windowId: state.id, projectPath, focused: focused === state.window })
    }
    return { currentWindowId: current.id, items }
  })
  ipcMain.handle('wharness:windows:focus-project', (event, request) => {
    trustedSender(event)
    const projectPath = canonicalProjectPath(request?.projectPath)
    const owner = [...desktopWindows.values()].find((state) => !state.window.isDestroyed() && !state.transientSurface && state.projects.has(projectPath))
    if (!owner) throw new Error('O projeto já não está aberto noutra janela do Wharnex.')
    sendToWindowState(owner, 'wharness:windows:activate-project', { projectPath })
    owner.window.show(); owner.window.focus()
    return { ok: true, windowId: owner.id, projectPath }
  })
  ipcMain.handle('wharness:windows:open', (event, request) => {
    trustedSender(event)
    const requestedProject = typeof request?.projectPath === 'string' && request.projectPath.trim() ? canonicalProjectPath(request.projectPath) : ''
    const launch = requestedProject ? { recovery: { projects: [requestedProject], activeProject: requestedProject, pending: false } } : {}
    const windowState = createWindow(undefined, true, launch)
    windowState.window.show(); windowState.window.focus()
    return { ok: true, windowId: windowState.id }
  })
  ipcMain.handle('wharness:windows:open-surface', (event, request) => {
    const owner = trustedSender(event)
    const surface = normalizedWorkspaceSurface(request)
    if (!owner.projects.has(surface.projectPath)) throw new Error('A superfície só pode ser destacada a partir de um projeto aberto nesta janela.')
    const windowState = createWindow(`surface-${randomUUID()}`, false, { surface })
    windowState.window.show(); windowState.window.focus()
    return { ok: true, windowId: windowState.id }
  })
  ipcMain.handle('wharness:windows:move-surface', (event, request) => {
    const owner = trustedSender(event)
    const surface = normalizedWorkspaceSurface(request)
    if (!owner.projects.has(surface.projectPath)) throw new Error('A superfície só pode ser movida a partir de um projeto aberto nesta janela.')
    let point = { x: Number(request?.screenX), y: Number(request?.screenY) }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || (point.x === 0 && point.y === 0)) point = screen.getCursorScreenPoint()
    const destination = desktopWindowAtScreenPoint(point, owner.id)
    if (destination) {
      if (destination.activeProject !== surface.projectPath) return { ok: false, action: 'blocked', reason: 'different-project', message: 'Não é possível mover tabs entre janelas de projetos diferentes.' }
      sendToWindowState(destination, 'wharness:windows:receive-surface', { surface })
      destination.window.show(); destination.window.focus()
      return { ok: true, action: 'moved', windowId: destination.id }
    }
    const windowState = createWindow(`surface-${randomUUID()}`, false, { surface })
    windowState.window.show(); windowState.window.focus()
    return { ok: true, action: 'opened', windowId: windowState.id }
  })
  ipcMain.handle('wharness:windows:minimize', (event) => {
    const windowState = trustedSender(event)
    windowState.window.minimize()
    return { ok: true }
  })
  ipcMain.handle('wharness:windows:toggle-maximize', (event) => {
    const windowState = trustedSender(event)
    if (windowState.window.isMaximized()) windowState.window.unmaximize()
    else windowState.window.maximize()
    return { ok: true, maximized: windowState.window.isMaximized() }
  })
  ipcMain.handle('wharness:windows:close', (event) => {
    const windowState = trustedSender(event)
    setTimeout(() => {
      if (!windowState.window.isDestroyed()) windowState.window.close()
    }, 0)
    return { ok: true }
  })
  ipcMain.handle('wharness:windows:acknowledge-close', (event) => {
    return desktopWindowClose.acknowledge(trustedSender(event))
  })
  ipcMain.handle('wharness:windows:resolve-close', (event, request) => {
    return desktopWindowClose.resolve(trustedSender(event), request?.action)
  })
}
