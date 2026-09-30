import { describe, expect, it, vi } from 'vitest'
import { newWorkspaceChat } from '../../../lib/chat'
import { workspaceSurfaceKey, type WorkspaceSurfaceTarget } from '../../../lib/workspace'
import { createSurfaceTransferActions, type SurfaceTransferOptions } from './transfer'

function fixture() {
  const first = newWorkspaceChat('session-1', 'First')
  const second = newWorkspaceChat('session-2', 'Second')
  let hiddenSurfaceKeys: string[] = []
  let surfaceTabs: WorkspaceSurfaceTarget[] = []
  const setMode = vi.fn()
  const setError = vi.fn()
  const setEditorOpenPath = vi.fn()
  const setEditorOpenNonce = vi.fn()
  const setTerminalOpen = vi.fn()
  const setActiveSurfaceKey = vi.fn()
  const selectChat = vi.fn(async () => {})
  const options: SurfaceTransferOptions = {
    projectPath: '/project', activeChatId: first.id, activeChatIdRef: { current: first.id },
    activeSurfaceKey: '', hiddenSurfaceKeys, chats: [first, second], setMode, setError,
    setEditorOpenPath, setEditorOpenNonce, setTerminalOpen, setActiveSurfaceKey, selectChat,
    setHiddenSurfaceKeys: (update) => { hiddenSurfaceKeys = typeof update === 'function' ? update(hiddenSurfaceKeys) : update },
    setSurfaceTabs: (update) => { surfaceTabs = typeof update === 'function' ? update(surfaceTabs) : update },
  }
  return {
    first, second, options, setMode, setError, setEditorOpenPath, setTerminalOpen,
    setActiveSurfaceKey, selectChat,
    get hiddenSurfaceKeys() { return hiddenSurfaceKeys },
    set surfaceTabs(value: WorkspaceSurfaceTarget[]) { surfaceTabs = value },
    get surfaceTabs() { return surfaceTabs },
  }
}

describe('workspace surface transfer', () => {
  it('rejects a surface from another project before changing the active mode', () => {
    const state = fixture()
    const actions = createSurfaceTransferActions(state.options)
    actions.activateWorkspaceSurface({ projectPath: '/other', kind: 'editor', path: 'file.ts' })
    expect(state.setError).toHaveBeenCalledWith('Não é possível mover tabs entre janelas de projetos diferentes.')
    expect(state.setMode).not.toHaveBeenCalled()
    expect(state.setEditorOpenPath).not.toHaveBeenCalled()
  })

  it('hides a moved active chat and selects the next visible chat', () => {
    const state = fixture()
    const actions = createSurfaceTransferActions(state.options)
    const moved = { projectPath: '/project', kind: 'chat' as const, chatId: state.first.id }
    actions.removeMovedSurfaceFromThisWindow(moved)
    expect(state.hiddenSurfaceKeys).toEqual([workspaceSurfaceKey(moved)])
    expect(state.selectChat).toHaveBeenCalledExactlyOnceWith(state.second.id)
  })

  it('activates the remaining tab after moving the current window tab', async () => {
    const state = fixture()
    const moved = { projectPath: '/project', kind: 'chat' as const, chatId: state.first.id }
    const remaining = { projectPath: '/project', kind: 'chat' as const, chatId: state.second.id }
    state.surfaceTabs = [moved, remaining]
    const actions = createSurfaceTransferActions({ ...state.options, surfaceHost: 'window', activeSurfaceKey: workspaceSurfaceKey(moved) })
    actions.removeMovedSurfaceFromThisWindow(moved)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(state.surfaceTabs).toEqual([remaining])
    expect(state.setActiveSurfaceKey).toHaveBeenCalledWith(workspaceSurfaceKey(remaining))
    expect(state.selectChat).toHaveBeenCalledWith(state.second.id)
  })
})
