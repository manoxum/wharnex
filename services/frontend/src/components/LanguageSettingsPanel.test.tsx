import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { LanguageSettingsPanel } from './LanguageSettingsPanel'

vi.mock('../lib/api', () => ({ api: {
  languageSettings: vi.fn().mockResolvedValue({ version: 1, interface_language: 'pt', translation_languages: ['en'] }),
  updateLanguageSettings: vi.fn().mockImplementation(async (value) => value),
} }))

describe('LanguageSettingsPanel', () => {
  it('persists the interface locale and one-or-more translation targets', async () => {
    render(<LanguageSettingsPanel onError={vi.fn()}/>)
    const locale = await screen.findByRole('combobox', { name: 'Idioma da interface' })
    fireEvent.change(locale, { target: { value: 'fr' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Português/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar idiomas' }))
    await waitFor(() => expect(api.updateLanguageSettings).toHaveBeenCalledWith({ version: 1, interface_language: 'fr', translation_languages: ['en', 'pt'] }))
    expect(document.documentElement.lang).toBe('fr')
  })
})
