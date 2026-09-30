import { desktopBridge } from '../../../lib/desktop'
import { errorMessage as messageOf, workspaceSurfaceKey, workspaceSurfaceURL, type WorkspaceSurfaceTarget, type WorkspaceSurfaceTransferPoint } from '../../../lib/workspace'
import type { WorkspaceChat } from '../../../lib/chat'
import type { WorkspaceMode } from '../../../types'
import type { Dispatch, SetStateAction } from 'react'

type Setter<T> = Dispatch<SetStateAction<T>>

export interface SurfaceTransferOptions {
  projectPath: string
  surfaceHost?: string
  activeChatId: string
  activeChatIdRef: { current: string }
  activeSurfaceKey: string
  hiddenSurfaceKeys: string[]
  chats: WorkspaceChat[]
  setMode: Setter<WorkspaceMode>
  setError: Setter<string | undefined>
  setEditorOpenPath: Setter<string | undefined>
  setEditorOpenNonce: Setter<number>
  setTerminalOpen: Setter<boolean>
  setSurfaceTabs: Setter<WorkspaceSurfaceTarget[]>
  setActiveSurfaceKey: Setter<string>
  setHiddenSurfaceKeys: Setter<string[]>
  selectChat: (chatId: string) => Promise<void>
}

export function createSurfaceTransferActions(options: SurfaceTransferOptions) {
  function activateWorkspaceSurface(target: WorkspaceSurfaceTarget) {
    if (target.projectPath !== options.projectPath) {
      options.setError('Não é possível mover tabs entre janelas de projetos diferentes.')
      return
    }
    if (target.kind === 'chat') {
      options.setMode('agent')
      if (target.chatId && target.chatId !== options.activeChatIdRef.current) void options.selectChat(target.chatId)
      return
    }
    if (target.kind === 'editor') {
      options.setMode('editor')
      if (target.path) {
        options.setEditorOpenPath(target.path)
        options.setEditorOpenNonce((nonce) => nonce + 1)
      }
      return
    }
    options.setTerminalOpen(true)
  }

  function detachSurface(target: WorkspaceSurfaceTarget) {
    const bridge = desktopBridge()
    if (bridge) {
      void bridge.windows.openSurface(target).catch((cause) => options.setError(messageOf(cause)))
      return
    }
    window.open(workspaceSurfaceURL(target, 'window'), '_blank', 'noopener,noreferrer')
  }

  function removeMovedSurfaceFromThisWindow(target: WorkspaceSurfaceTarget) {
    const key = workspaceSurfaceKey(target)
    if (options.surfaceHost === 'window') {
      options.setSurfaceTabs((current) => {
        const next = current.filter((item) => workspaceSurfaceKey(item) !== key)
        if (options.activeSurfaceKey === key) {
          const replacement = next[0]
          queueMicrotask(() => {
            if (!replacement) { void desktopBridge()?.windows.close(); return }
            options.setActiveSurfaceKey(workspaceSurfaceKey(replacement))
            activateWorkspaceSurface(replacement)
          })
        }
        return next
      })
      return
    }
    options.setHiddenSurfaceKeys((current) => current.includes(key) ? current : [...current, key])
    if (target.kind === 'chat' && target.chatId === options.activeChatId) {
      const hidden = new Set([...options.hiddenSurfaceKeys, key])
      const replacement = options.chats.find((chat) => !hidden.has(workspaceSurfaceKey({ kind: 'chat', chatId: chat.id })))
      if (replacement) void options.selectChat(replacement.id)
    }
  }

  function moveSurfaceByDrag(target: WorkspaceSurfaceTarget, point: WorkspaceSurfaceTransferPoint) {
    const bridge = desktopBridge()
    if (!bridge) { detachSurface(target); return }
    void bridge.windows.moveSurface({ ...target, ...point }).then((result) => {
      if (!result.ok) { options.setError(result.message || 'Não foi possível mover a tab para essa janela.'); return }
      removeMovedSurfaceFromThisWindow(target)
    }).catch((cause) => options.setError(messageOf(cause)))
  }

  return { activateWorkspaceSurface, detachSurface, removeMovedSurfaceFromThisWindow, moveSurfaceByDrag }
}
