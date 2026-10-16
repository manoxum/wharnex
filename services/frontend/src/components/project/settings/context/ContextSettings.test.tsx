import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectConfig } from '../../../../types'
import { ContextSettings } from './ContextSettings'

const config: ProjectConfig = { version: 1, project: { name: 'atlas' }, context: { auto_exclude: true, max_file_bytes: 2097152, include: [], exclude: [] } }
describe('context settings', () => {
  it('preserves explicit inclusion/exclusion edits and the automatic pruning choice', () => {
    const onConfig = vi.fn(), onInclude = vi.fn(), onExclude = vi.fn(), onMaxMiB = vi.fn()
    const { container } = render(<ContextSettings config={config} include="src/**" exclude="build/**" maxMiB={2} saving={false} onConfig={onConfig} onInclude={onInclude} onExclude={onExclude} onMaxMiB={onMaxMiB} onMode={vi.fn()}/>)
    fireEvent.click(screen.getByRole('checkbox', { name: /Reconhecimento automático/ }))
    expect(onConfig).toHaveBeenCalledWith({ ...config, context: { ...config.context, auto_exclude: false } })
    fireEvent.click(container.querySelector('summary')!)
    fireEvent.change(screen.getByRole('textbox', { name: /Incluir apenas/ }), { target: { value: 'docs/**' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Excluir do contexto/ }), { target: { value: '*.log' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tamanho máximo por ficheiro' }), { target: { value: '4' } })
    expect(onInclude).toHaveBeenCalledWith('docs/**')
    expect(onExclude).toHaveBeenCalledWith('*.log')
    expect(onMaxMiB).toHaveBeenCalledWith(4)
    expect(screen.getByText(/Segredos, chaves privadas/)).toBeTruthy()
    expect(config.context.auto_exclude).toBe(true)
  })
})
