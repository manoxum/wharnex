import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
import { ProjectKnowledgeDrawer } from './ProjectKnowledgeDrawer'
import { splitKnowledgeSections } from './projectKnowledgeSections'

const session = {
  id: 'ses-knowledge', project_path: '/workspace/demo', state: 'applied', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-07T10:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

describe('ProjectKnowledgeDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('indexes markdown headings and explores one acquired topic at a time', async () => {
    vi.spyOn(api, 'projectKnowledge').mockResolvedValue({ knowledge: {
      project_path: '/workspace/demo', version: 3, updated_at: '2026-09-07T10:10:00.000Z', updated_by_request_id: 'req-review',
      content: '# Arquitetura\n\n- API local.\n\n## Toolchain\n\n- Node 22.',
    } })
    render(<ProjectKnowledgeDrawer session={session} onClose={vi.fn()}/>)

    fireEvent.click(await screen.findByRole('button', { name: 'Toolchain' }))
    expect(screen.getByText('Node 22.')).toBeTruthy()
    expect(screen.queryByText('API local.')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Pesquisar conhecimentos' }), { target: { value: 'arquitetura' } })
    expect(screen.getByRole('button', { name: 'Arquitetura' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Toolchain' })).toBeNull()
  })

  it('keeps heading-free knowledge explorable as a complete document', () => {
    expect(splitKnowledgeSections('- aprendizagem única')).toEqual([{ id: 'section-0', title: 'Visão geral', markdown: '- aprendizagem única' }])
  })
})
