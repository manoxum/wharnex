import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopRecoveryDialog } from './DesktopRecoveryDialog'

afterEach(cleanup)

function open(projects = ['/workspace/wharnex'], busy = false) {
  const onRecover = vi.fn()
  const onDiscard = vi.fn()
  render(<DesktopRecoveryDialog projects={projects} busy={busy} onRecover={onRecover} onDiscard={onDiscard}/>)
  return { onRecover, onDiscard }
}

describe('DesktopRecoveryDialog', () => {
  it('replaces the native message box with a themed modal that names the saved projects', () => {
    open(['/workspace/wharnex'])
    const dialog = screen.getByRole('alertdialog')

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // Native WebContentsViews paint above renderer DOM, so the backdrop has to
    // claim the ChatGPT overlay blocker exactly like the close modal does.
    expect(dialog.textContent).toContain('Recuperar a última sessão de wharnex?')
    expect(screen.getByTitle('/workspace/wharnex')).toBeTruthy()
  })

  it('summarises a multi-project session instead of asking once per project', () => {
    open(['/workspace/alpha', '/workspace/beta', '/workspace/gama'])

    expect(screen.getByRole('alertdialog').textContent).toContain('Recuperar os 3 projetos da última sessão?')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it.each([
    ['Recuperar sessão', 'recover'],
    ['Descartar sessão', 'discard'],
  ])('reports %s to the shell', (label, intent) => {
    const { onRecover, onDiscard } = open()
    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(onRecover).toHaveBeenCalledTimes(intent === 'recover' ? 1 : 0)
    expect(onDiscard).toHaveBeenCalledTimes(intent === 'discard' ? 1 : 0)
  })

  it('treats Escape as discarding, and ignores it while the restore is already running', () => {
    const { onDiscard } = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDiscard).toHaveBeenCalledTimes(1)

    cleanup()
    const busy = open(['/workspace/wharnex'], true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(busy.onDiscard).not.toHaveBeenCalled()
  })
})
