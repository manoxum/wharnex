import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsFrame } from './SettingsFrame'

describe('settings administration frame', () => {
  it('filters categories without discarding the current content or pending changes', () => {
    const section = vi.fn(), save = vi.fn()
    render(<SettingsFrame projectPath="/workspace/project" section="context" onSection={section} onClose={vi.fn()} dirty onSave={save}><input aria-label="Rascunho" defaultValue="preservado"/></SettingsFrame>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Pesquisar definições' }), { target: { value: 'tema' } })
    expect(screen.getByRole('button', { name: /Aparência/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Storage remoto/ })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Rascunho' }) as HTMLInputElement).value).toBe('preservado')
    expect(screen.getByText('Alterações por guardar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar e reconstruir contexto' }))
    expect(save).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('combobox', { name: 'Categoria das configurações' }), { target: { value: 'language' } })
    expect(section).toHaveBeenCalledWith('language')
  })
  it('omits project-only categories in global settings and makes closing explicit', () => {
    const close = vi.fn()
    render(<SettingsFrame section="appearance" onSection={vi.fn()} onClose={close}>Preferências</SettingsFrame>)
    expect(screen.queryByRole('button', { name: /Contexto/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar configurações' }))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
