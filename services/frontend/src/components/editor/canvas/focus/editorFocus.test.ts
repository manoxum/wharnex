import { afterEach, expect, it, vi } from 'vitest'
import { focusEditorWhenAvailable } from './editorFocus'
afterEach(() => document.body.replaceChildren())
it('preserves a user-owned popover during a deferred editor mount or reveal', () => {
  const floating = document.createElement('div'); floating.role = 'dialog'; floating.tabIndex = -1
  document.body.append(floating); floating.focus()
  const editor = { focus: vi.fn() }
  focusEditorWhenAvailable(editor, document.createElement('div'))
  expect(editor.focus).not.toHaveBeenCalled()
})
it('still focuses code on normal document changes and within an editor dialog', () => {
  const editor = { focus: vi.fn() }; const host = document.createElement('div')
  focusEditorWhenAvailable(editor, host)
  expect(editor.focus).toHaveBeenCalledOnce()
  const floating = document.createElement('div'); floating.role = 'dialog'
  const input = document.createElement('input'); host.append(input); floating.append(host); document.body.append(floating); input.focus()
  focusEditorWhenAvailable(editor, host)
  expect(editor.focus).toHaveBeenCalledTimes(2)
})

it('retains editor autofocus when the focused dialog owns the editor itself', () => {
  const floating = document.createElement('div'); floating.role = 'dialog'
  const host = document.createElement('div'); const close = document.createElement('button')
  floating.append(close, host); document.body.append(floating); close.focus()
  const editor = { focus: vi.fn() }
  focusEditorWhenAvailable(editor, host)
  expect(editor.focus).toHaveBeenCalledOnce()
})
