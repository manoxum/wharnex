import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { TranslatableMarkdown } from './TranslatableMarkdown'

vi.mock('../lib/api', () => ({
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
    fireEvent.click(screen.getByRole('button', { name: 'Ver original' }))
    expect(screen.getByText('Olá')).toBeTruthy()
  })

  it('reports a translation failure immediately without exposing transport detail', async () => {
    vi.mocked(api.translateMarkdown).mockRejectedValueOnce(new Error('chat-agent API 503: provider suspended'))
    render(<TranslatableMarkdown sessionId="ses_1" markdown="# Olá" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Traduzir' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A tradução falhou. Tente novamente mais tarde.')
    expect((screen.getByRole('button', { name: 'Traduzir' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
