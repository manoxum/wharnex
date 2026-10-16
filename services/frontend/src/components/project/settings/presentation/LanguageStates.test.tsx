import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageSettingsPanel } from '../LanguageSettingsPanel'
import { api } from '../../../../lib/transport/http/api'

vi.mock('../../../../lib/transport/http/api', () => ({ api: { languageSettings: vi.fn(), updateLanguageSettings: vi.fn(async (value) => value) } }))
afterEach(() => vi.clearAllMocks())
describe('language settings feedback', () => {
  it('ends loading on failure and retries only after an explicit action', async () => {
    vi.mocked(api.languageSettings).mockRejectedValueOnce(new Error('Ligação indisponível')).mockResolvedValueOnce({ version: 1, interface_language: 'pt', translation_languages: ['en'] })
    render(<LanguageSettingsPanel onError={vi.fn()}/>)
    expect(await screen.findByText('Ligação indisponível')).toBeTruthy()
    expect(screen.queryByText('A carregar idiomas…')).toBeNull()
    expect(api.languageSettings).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByRole('combobox', { name: 'Idioma da interface' })
    expect(api.languageSettings).toHaveBeenCalledTimes(2)
  })
  it('keeps the final translation language selected and available when saving', async () => {
    vi.mocked(api.languageSettings).mockResolvedValue({ version: 1, interface_language: 'pt', translation_languages: ['en'] })
    render(<LanguageSettingsPanel onError={vi.fn()}/>)
    const target = await screen.findByRole('checkbox', { name: /English/ }) as HTMLInputElement
    expect(target.checked && target.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar idiomas' }))
    await waitFor(() => expect(api.updateLanguageSettings).toHaveBeenCalledWith({ version: 1, interface_language: 'pt', translation_languages: ['en'] }))
  })
})
