import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { EvolutionEvidence, Session } from '../types'
import { EvolutionEvidenceDrawer } from './EvolutionEvidenceDrawer'

const session = {
  id: 'ses-evolution', project_path: '/workspace/wharnex', state: 'applied', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-24T10:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharnex', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

const evidence: EvolutionEvidence = {
  events: [{
    id: 'evt-1', session_id: 'ses-old', type: 'execution.failed', timestamp: '2026-09-24T09:00:00.000Z',
    data: { failure_kind: 'verification_failed' }, project_path: '/workspace/wharnex', project_name: 'wharnex', category: 'execution',
  }],
  counts: { execution: 1 }, projects: ['/workspace/wharnex'], categories: ['execution'], total: 1, truncated: false,
  knowledge: [{
    project_path: '/workspace/wharnex', project_name: 'wharnex', id: 'verification-pattern', category: 'verification',
    excerpt: 'Valide o cenário focado antes do gate amplo.', version: 2, updated_at: '2026-09-24T09:30:00.000Z',
  }],
  knowledge_counts: { verification: 1 }, knowledge_categories: ['verification'], knowledge_total: 1, knowledge_truncated: false,
}

describe('EvolutionEvidenceDrawer modalities', () => {
  afterEach(() => vi.restoreAllMocks())

  it('presents events, knowledge and external logs as three first-class modes', async () => {
    vi.spyOn(api, 'evolutionEvidence').mockResolvedValue(evidence)
    render(<EvolutionEvidenceDrawer session={session} busy={false} onAnalyze={vi.fn(async () => undefined)} onClose={vi.fn()}/>)

    expect(await screen.findByRole('tab', { name: /Eventos/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Conhecimento/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Logs externos/ }))

    expect(screen.getByText('Importar logs externos')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Filtrar projeto' })).toBeNull()
    expect((screen.getByLabelText('Carregar logs externos') as HTMLInputElement).accept).toBe('.zip,.md,.json,.log,.txt')
  })

  it('combines evidence selected from all three modes in one analysis', async () => {
    vi.spyOn(api, 'evolutionEvidence').mockResolvedValue(evidence)
    const onAnalyze = vi.fn(async () => undefined)
    render(<EvolutionEvidenceDrawer session={session} busy={false} onAnalyze={onAnalyze} onClose={vi.fn()}/>)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar evento execution.failed' }))
    fireEvent.click(screen.getByRole('tab', { name: /Conhecimento/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar conhecimento verification-pattern' }))
    fireEvent.click(screen.getByRole('tab', { name: /Logs externos/ }))

    const file = new File(['{"plan":"failed"}'], 'external-run.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Carregar logs externos'), { target: { files: [file] } })
    expect(screen.getByText('external-run.json')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Analisar e evoluir/ }))
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith(
      ['evt-1'],
      [{ project_path: '/workspace/wharnex', id: 'verification-pattern' }],
      [file],
      false,
    ))
  })

  it('samples recent operational events for knowledge reviews unless the operator opts out', async () => {
    vi.spyOn(api, 'evolutionEvidence').mockResolvedValue(evidence)
    const onAnalyze = vi.fn(async () => undefined)
    render(<EvolutionEvidenceDrawer session={session} busy={false} onAnalyze={onAnalyze} onClose={vi.fn()}/>)

    fireEvent.click(await screen.findByRole('tab', { name: /Conhecimento/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar conhecimento verification-pattern' }))

    const optOut = screen.getByRole('checkbox', { name: 'Analisar apenas conhecimento selecionado' })
    expect((optOut as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/amostra limitada de eventos operacionais recentes de alto sinal/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Analisar e evoluir/ }))
    await waitFor(() => expect(onAnalyze).toHaveBeenLastCalledWith(
      [],
      [{ project_path: '/workspace/wharnex', id: 'verification-pattern' }],
      [],
      false,
    ))

    fireEvent.click(optOut)
    fireEvent.click(screen.getByRole('button', { name: /Analisar e evoluir/ }))
    await waitFor(() => expect(onAnalyze).toHaveBeenLastCalledWith(
      [],
      [{ project_path: '/workspace/wharnex', id: 'verification-pattern' }],
      [],
      true,
    ))
  })
})
