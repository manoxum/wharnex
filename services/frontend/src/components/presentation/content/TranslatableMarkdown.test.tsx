import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { TranslatableMarkdown } from './TranslatableMarkdown'

vi.mock('../../../lib/transport/http/api', () => ({
  api: {
    languageSettings: vi.fn().mockResolvedValue({ version: 1, interface_language: 'pt', translation_languages: ['en', 'fr'] }),
    translateMarkdown: vi.fn().mockResolvedValue({ protocol: 'harness.utility/v1', task: 'translate_markdown', target_language: 'en', markdown: '# Hello' }),
  },
}))

describe('TranslatableMarkdown', () => {
  it('keeps the source immutable and swaps only viewer state after translation', async () => {
    render(<TranslatableMarkdown sessionId="ses_1" markdown="# Olá" />)
    expect(await screen.findByRole('button', { name: 'Traduzir' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Traduzir' }))
    await waitFor(() => expect(api.translateMarkdown).toHaveBeenCalledWith('ses_1', 'en', '# Olá'))
    expect(await screen.findByText('Hello')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Tradução concluída')
    fireEvent.click(screen.getByRole('button', { name: 'Ver original' }))
    expect(screen.getByText('Olá')).toBeTruthy()
  })

  it('shows that the Translator request is waiting for a result while the API is pending', async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.translateMarkdown>>) => void
    vi.mocked(api.translateMarkdown).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<TranslatableMarkdown sessionId="ses_1" markdown="# Olá" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Traduzir' }))
    expect(screen.getByRole('status').textContent).toContain('Tradução solicitada ao Translator')
    finish({ protocol: 'harness.utility/v1', task: 'translate_markdown', target_language: 'en', markdown: '# Hello' })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Tradução concluída'))
  })

  it('reports a translation failure immediately without exposing transport detail', async () => {
    vi.mocked(api.translateMarkdown).mockRejectedValueOnce(new Error('chat-agent API 503: provider suspended'))
    render(<TranslatableMarkdown sessionId="ses_1" markdown="# Olá" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Traduzir' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A tradução falhou. Tente novamente mais tarde.')
    expect((screen.getByRole('button', { name: 'Traduzir' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
