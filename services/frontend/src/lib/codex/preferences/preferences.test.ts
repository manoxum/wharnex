import { beforeEach, expect, it, vi } from 'vitest'
import { createCodexComposerControls, resolveCodexSelection } from './index'
import { durableWorkspaceChat, mergeDurableWorkspaceChats, newWorkspaceChat } from '../../chat/history/workspaceMemory'

beforeEach(() => localStorage.clear())

it('restores the last model and effort for a new chat after recreating the controls', () => {
  const update = vi.fn()
  createCodexComposerControls(undefined, false, false, update).onCodexModel('model-a')
  createCodexComposerControls({ codexModel: 'model-a' }, false, false, update).onCodexEffort('xhigh')
  expect(resolveCodexSelection()).toEqual({ codexModel: 'model-a', codexEffort: 'xhigh' })
  const restored = createCodexComposerControls(undefined, false, false, update)
  expect(restored.codexModel).toBe('model-a'); expect(restored.codexEffort).toBe('xhigh')
  restored.onEngine('codex')
  expect(update).toHaveBeenLastCalledWith({ engine: 'codex', codexModel: 'model-a', codexEffort: 'xhigh' })
})

it('remembers effort per model while preserving each durable chat selection', () => {
  const update = vi.fn()
  createCodexComposerControls({ codexModel: 'model-a' }, false, false, update).onCodexEffort('xhigh')
  createCodexComposerControls({ codexModel: 'model-b' }, false, false, update).onCodexEffort('low')
  createCodexComposerControls(undefined, false, false, update).onCodexModel('model-a')
  expect(update).toHaveBeenLastCalledWith({ codexModel: 'model-a', codexEffort: 'xhigh' })
  const chat = { ...newWorkspaceChat('session', 'Existing', 'chat'), codexModel: 'model-b', codexEffort: 'low' }
  expect(resolveCodexSelection(mergeDurableWorkspaceChats([], [durableWorkspaceChat('/project', chat)])[0])).toEqual({ codexModel: 'model-b', codexEffort: 'low' })
  expect(resolveCodexSelection({ codexModel: '', codexEffort: '' })).toEqual({ codexModel: '', codexEffort: '' })
})

it('does not change defaults during an active request or inherit permissions', () => {
  const update = vi.fn(), controls = createCodexComposerControls(undefined, true, true, update)
  controls.onCodexModel('model-a'); controls.onCodexEffort('high'); controls.onCodexPermission('full'); controls.onEngine('codex')
  expect(update).not.toHaveBeenCalled()
  expect(resolveCodexSelection()).toEqual({ codexModel: '', codexEffort: '' })
  expect(createCodexComposerControls(undefined, false, false, update).codexPermission).toBeUndefined()
})
it('preserves an existing chat effort before switching models, even before its first new submission', () => {
  const update = vi.fn()
  createCodexComposerControls({ codexModel: 'existing', codexEffort: 'xhigh' }, false, false, update).onCodexModel('other')
  createCodexComposerControls({ codexModel: 'other', codexEffort: '' }, false, false, update).onCodexModel('existing')
  expect(update).toHaveBeenLastCalledWith({ codexModel: 'existing', codexEffort: 'xhigh' })
})
