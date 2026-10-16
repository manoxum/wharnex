import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import type { EvolutionEvidence, Session } from '../../../types'
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

  it('renders long event histories in ordered batches while keeping result selection available', async () => {
    const events = Array.from({ length: 240 }, (_, index) => ({
      ...evidence.events[0], id: `evt-${index}`, type: `execution.event-${index}`,
    }))
    vi.spyOn(api, 'evolutionEvidence').mockResolvedValue({ ...evidence, events, total: events.length })
    const { container } = render(<EvolutionEvidenceDrawer session={session} busy={false} onAnalyze={vi.fn(async () => undefined)} onClose={vi.fn()}/> )

    expect(await screen.findByLabelText('Selecionar evento execution.event-239')).toBeTruthy()
    expect(screen.getAllByRole('checkbox', { name: /^Selecionar evento/ })).toHaveLength(100)
    expect(screen.getByText('A mostrar 100 de 240 eventos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais 100 eventos' }))
    expect(screen.getAllByRole('checkbox', { name: /^Selecionar evento/ })).toHaveLength(200)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais 40 eventos' }))
    expect(await screen.findByLabelText('Selecionar evento execution.event-0')).toBeTruthy()
    expect(screen.getAllByRole('checkbox', { name: /^Selecionar evento/ })).toHaveLength(events.length)
    const records = container.querySelectorAll('article')
    expect(records).toHaveLength(events.length)
    expect(records[0].className).toContain('[content-visibility:auto]')
    expect(records[0].querySelector('input')?.getAttribute('aria-label')).toBe('Selecionar evento execution.event-239')
    expect(records[events.length - 1].querySelector('input')?.getAttribute('aria-label')).toBe('Selecionar evento execution.event-0')
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar resultados' }))
    expect(screen.getByText('240 prontos')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Pesquisar evidência'), { target: { value: 'execution.event-239' } })
    expect(screen.getAllByRole('checkbox', { name: /^Selecionar evento/ })).toHaveLength(1)
    expect(screen.getByText('A mostrar 1 de 1 eventos')).toBeTruthy()
    expect((screen.getByLabelText('Selecionar evento execution.event-239') as HTMLInputElement).checked).toBe(true)
  })
})
