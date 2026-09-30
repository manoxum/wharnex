import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import type { Session } from '../../../types'
import { ProjectKnowledgeDrawer } from './ProjectKnowledgeDrawer'

const session = {
  id: 'ses-knowledge', project_path: '/workspace/demo', state: 'applied', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-07T10:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

const catalog = {
  project_path: '/workspace/demo', revision: 8, updated_at: '2026-09-07T10:10:00.000Z', updated_by_request_id: 'req-review',
  entries: [
    { id: 'toolchain-node', category: 'runtime_environment' as const, version: 3, updated_at: '2026-09-07T10:10:00.000Z', content: 'When building Desktop, use Node 22.' },
    { id: 'billing-rules', category: 'product_domain' as const, version: 2, updated_at: '2026-09-06T10:10:00.000Z', content: 'Billing is project-specific.' },
  ],
}

describe('ProjectKnowledgeDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows categorized catalog records and filters them', async () => {
    vi.spyOn(api, 'projectKnowledgeCatalog').mockResolvedValue({ catalog })
    render(<ProjectKnowledgeDrawer session={session} onClose={vi.fn()}/>)

    expect(await screen.findByRole('button', { name: /toolchain-node/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar categoria de conhecimento' }), { target: { value: 'product_domain' } })
    expect(screen.getByRole('button', { name: /billing-rules/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /toolchain-node/ })).toBeNull()
  })

  it('starts GPT consolidation from the knowledge panel', async () => {
    vi.spyOn(api, 'projectKnowledgeCatalog').mockResolvedValue({ catalog })
    const onConsolidate = vi.fn(async () => undefined)
    render(<ProjectKnowledgeDrawer session={session} onConsolidate={onConsolidate} onClose={vi.fn()}/>)

    fireEvent.click(await screen.findByRole('button', { name: /Consolidar com GPT/i }))
    expect(onConsolidate).toHaveBeenCalledTimes(1)
  })

  it('blocks duplicate consolidation while the maintenance request is pending', async () => {
    vi.spyOn(api, 'projectKnowledgeCatalog').mockResolvedValue({ catalog })
    const pendingSession = {
      ...session,
      last_request_id: 'req-knowledge',
      pending_manual_request_ids: ['req-knowledge'],
      request_lineages: {
        'req-knowledge': { request_id: 'req-knowledge', root_request_id: 'req-knowledge', kind: 'knowledge_consolidation' as const, created_at: '2026-09-07T10:11:00.000Z' },
      },
    }
    render(<ProjectKnowledgeDrawer session={pendingSession} onConsolidate={vi.fn(async () => undefined)} onClose={vi.fn()}/>)

    const button = await screen.findByRole('button', { name: /Consolidação em curso/i })
    expect(button).toHaveProperty('disabled', true)
  })
})
