import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextInspector } from './ContextInspector'

const inspection = {
  snapshot_id: 'ctx-1', sha256: 'abcdef123456', project_root: '/tmp/demo', included_files: 2, excluded_items: 1, included_bytes: 1200,
  roots: [
    { path: 'src', name: 'src', kind: 'directory', status: 'included', included_files: 2, excluded_items: 0, included_bytes: 1200 },
    { path: 'node_modules', name: 'node_modules', kind: 'directory', status: 'excluded', included_files: 0, excluded_items: 1, included_bytes: 0, reason: 'mandatory security/context exclusion' },
  ],
  entries: [
    { path: 'src/main.ts', kind: 'file', status: 'included', size: 1000, created_at: '2026-08-01T10:00:00Z', modified_at: '2026-09-01T10:00:00Z', configurable: true },
    { path: 'src/util.ts', kind: 'file', status: 'included', size: 200, created_at: '2026-08-02T10:00:00Z', modified_at: '2026-08-20T10:00:00Z', configurable: true },
    { path: '.android-sdk', kind: 'directory', status: 'excluded', reason: 'android sdk/toolchain', rule: 'auto-exclude', configurable: true },
    { path: 'node_modules', kind: 'directory', status: 'excluded', reason: 'mandatory security/context exclusion', rule: 'mandatory', configurable: false },
  ],
  rules: [{ id: 'mandatory-directories', source: 'Wharnex', label: 'Pastas protegidas', enabled: true, patterns: ['node_modules/'], description: 'Nunca entram.' }],
}

describe('ContextInspector', () => {
  it('explores exact final files, folder aggregates and applied rules', () => {
    render(<ContextInspector inspection={inspection} refreshing={false} onRefresh={() => undefined} />)
    expect(screen.getByText('src/main.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Por pasta/i }))
    fireEvent.click(screen.getByRole('button', { name: /Excluídos/i }))
    expect(screen.getByText('node_modules')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Regras$/i }))
    expect(screen.getByText('Pastas protegidas')).toBeTruthy()
    expect(screen.getByText('node_modules/')).toBeTruthy()
  })

  it('sorts inventory and emits safe context selection actions', () => {
    const onSelection = vi.fn()
    render(<ContextInspector inspection={inspection} refreshing={false} onRefresh={() => undefined} onSelection={onSelection} />)
    fireEvent.change(screen.getByRole('combobox', { name: /Ordenar contexto/i }), { target: { value: 'name' } })
    fireEvent.click(screen.getByTitle('Excluir src/main.ts'))
    expect(onSelection).toHaveBeenCalledWith({ path: 'src/main.ts', kind: 'file', action: 'exclude' })
    fireEvent.click(screen.getByRole('button', { name: /Por pasta/i }))
    fireEvent.click(screen.getByRole('button', { name: /Excluídos/i }))
    fireEvent.click(screen.getByTitle('Incluir .android-sdk'))
    expect(onSelection).toHaveBeenCalledWith({ path: '.android-sdk', kind: 'directory', action: 'include' })
    expect(screen.queryByTitle('Incluir node_modules')).toBeNull()
  })

  it('tolerates legacy null arrays from older context inspection payloads', () => {
    const legacy = { ...inspection, roots: null, entries: null, rules: [{ ...inspection.rules[0], patterns: null }] } as unknown as Parameters<typeof ContextInspector>[0]['inspection']
    render(<ContextInspector inspection={legacy} refreshing={false} onRefresh={() => undefined} />)
    expect(screen.getByText('No contexto')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Regras$/i }))
    expect(screen.getByText('sem padrões configurados')).toBeTruthy()
  })

})
