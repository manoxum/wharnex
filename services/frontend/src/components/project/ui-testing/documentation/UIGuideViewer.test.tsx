import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIGuide } from '../../../../types'
import { UIGuideViewer } from './UIGuideViewer'

const guide: UIGuide = { id: 'g1', test_id: 'login', run_id: 'run_1', title: 'Iniciar sessão', markdown: '## Passo a passo\n\n![Login](step-01.png)', pdf_ready: true, html_ready: true, updated_at: '' }

describe('UI guide viewer', () => {
  afterEach(() => { delete (window as { wharnessDesktop?: unknown }).wharnessDesktop })

  it('opens on the sandboxed HTML guide and switches to PDF and Markdown', () => {
    render(<UIGuideViewer sessionId="ses_1" guide={guide}/>)
    const html = screen.getByTitle('Guia Iniciar sessão')
    expect(html.getAttribute('src')).toContain('/ui-testing/assets/run_1/guide.html')
    expect(html.getAttribute('sandbox')).toBe('allow-scripts')
    fireEvent.click(screen.getByRole('tab', { name: /PDF/ }))
    expect(screen.getByTitle('PDF Iniciar sessão').getAttribute('src')).toContain('/run_1/guide.pdf')
    fireEvent.click(screen.getByRole('tab', { name: /Markdown/ }))
    expect(document.querySelector('img')?.getAttribute('src')).toContain('/run_1/step-01.png')
  })

  it('falls back to Markdown for a guide without an HTML version', () => {
    render(<UIGuideViewer sessionId="ses_1" guide={{ ...guide, html_ready: false, pdf_ready: false }}/>)
    expect(screen.queryByTitle('Guia Iniciar sessão')).toBeNull()
    expect(screen.getByRole('tab', { name: /HTML interativo/ }).hasAttribute('disabled') || screen.getByRole('tab', { name: /HTML interativo/ }).getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('expands into an application dialog closed by Escape', () => {
    render(<UIGuideViewer sessionId="ses_1" guide={guide}/>)
    fireEvent.click(screen.getByRole('button', { name: /Expandir/ }))
    expect(screen.getByRole('dialog', { name: 'Iniciar sessão — HTML interativo' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the selected format in the browser through the desktop bridge', async () => {
    const openGuide = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { wharnessDesktop?: unknown }).wharnessDesktop = { uiTesting: { openGuide } }
    render(<UIGuideViewer sessionId="ses_1" guide={guide}/>)
    fireEvent.click(screen.getByRole('tab', { name: /PDF/ }))
    fireEvent.click(screen.getByRole('button', { name: /Abrir no navegador/ }))
    await waitFor(() => expect(openGuide).toHaveBeenCalledWith({ sessionId: 'ses_1', runId: 'run_1', format: 'pdf' }))
  })
})

it('keeps the chosen format across a poll with unchanged guide identity', () => {
  const guide = { id: 'stable', test_id: 'test', run_id: 'run', title: 'Guia', markdown: 'Conteúdo', html_ready: true, pdf_ready: true, updated_at: '' }
  const view = render(<UIGuideViewer sessionId="ses_1" guide={guide}/>)
  fireEvent.click(screen.getByRole('tab', { name: 'Markdown' }))
  view.rerender(<UIGuideViewer sessionId="ses_1" guide={{ ...guide }}/>)
  expect(screen.getByRole('tab', { name: 'Markdown' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByTitle('Guia Guia')).toBeNull()
})
