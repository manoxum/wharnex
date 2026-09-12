import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextInspector } from './ContextInspector'

const inspection = {
  snapshot_id: 'ctx-1', sha256: 'abcdef123456', project_root: '/tmp/demo', included_files: 2, excluded_items: 1, included_bytes: 1200,
  roots: [
    { path: 'src', name: 'src', kind: 'directory', status: 'included', included_files: 2, excluded_items: 0, included_bytes: 1200 },
    { path: 'node_modules', name: 'node_modules', kind: 'directory', status: 'excluded', included_files: 0, excluded_items: 1, included_bytes: 0, reason: 'mandatory security/context exclusion' },
  ],
  entries: [
    { path: 'src/main.ts', kind: 'file', status: 'included', size: 1000 },
    { path: 'src/util.ts', kind: 'file', status: 'included', size: 200 },
    { path: 'node_modules', kind: 'directory', status: 'excluded', reason: 'mandatory security/context exclusion', rule: 'mandatory' },
  ],
  rules: [{ id: 'mandatory-directories', source: 'Wharnex', label: 'Pastas protegidas', enabled: true, patterns: ['node_modules/'], description: 'Nunca entram.' }],
}

describe('ContextInspector', () => {
  it('explores exact final files, root entries and applied rules', () => {
    render(<ContextInspector inspection={inspection} refreshing={false} onRefresh={() => undefined} />)
    expect(screen.getByText('src/main.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Estrutura base/i }))
    expect(screen.getByText('node_modules')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Regras$/i }))
    expect(screen.getByText('Pastas protegidas')).toBeTruthy()
    expect(screen.getByText('node_modules/')).toBeTruthy()
  })

  it('tolerates legacy null arrays from older context inspection payloads', () => {
    const legacy = { ...inspection, roots: null, entries: null, rules: [{ ...inspection.rules[0], patterns: null }] } as unknown as Parameters<typeof ContextInspector>[0]['inspection']
    render(<ContextInspector inspection={legacy} refreshing={false} onRefresh={() => undefined} />)
    expect(screen.getByText('No ZIP final')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Regras$/i }))
    expect(screen.getByText('sem padrões configurados')).toBeTruthy()
  })

})
