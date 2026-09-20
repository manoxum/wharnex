import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { parseDirectives } from '../lib/composerDirectives'
import { ComposerReferenceStrip } from './ComposerReferenceStrip'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, api: { ...actual.api, readFile: vi.fn(), referenceInspection: vi.fn(), attachmentInspection: vi.fn() } }
})

afterEach(() => vi.clearAllMocks())

describe('ComposerReferenceStrip', () => {
  it('renders distinct thumbnails for every directive kind', () => {
    const directives = parseDirectives('@{[todo]todo-1} @{[ref]core} @{[attach]/tmp/contracts} @{[file]src/App.tsx} @{[chat]artifact|art-1} @{[lib]session|ses-2|lib-1} @{[see]project|README.md}')
    const { container } = render(<ComposerReferenceStrip sessionId="ses-1" directives={directives} todos={[todo()]} chatFiles={[{ artifact_id:'art-1', direction:'input', source:'attachment', name:'chat.txt', size:12, created_at:'2026-01-01T00:00:00Z', direct:true }]} libraryArtifacts={[{ session_id:'ses-2', project_path:'/work/core', artifact:{ id:'lib-1', direction:'output', kind:'library', name:'report.md', size:20, sha256:'a'.repeat(64), created_at:'2026-01-01T00:00:00Z', expires_at:'2027-01-01T00:00:00Z', bundle:false } }]} uploads={[]} onRemove={vi.fn()}/>)
    expect(container.querySelectorAll('.composer-reference-thumbnail').length).toBe(7)
    for (const kind of ['todo','ref','attach','file','chat','lib','see']) expect(container.querySelector(`.composer-reference-thumbnail.kind-${kind}`)).not.toBeNull()
  })

  it('opens the dedicated TODO viewer from its thumbnail', () => {
    const directive = parseDirectives('@{[todo]todo-1}')[0]
    render(<ComposerReferenceStrip sessionId="ses-1" directives={[directive]} todos={[todo()]} chatFiles={[]} libraryArtifacts={[]} uploads={[]} onRemove={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: /Visualizar Corrigir fila/i }))
    expect(screen.getByRole('dialog', { name: 'Visualizar referência @todo' }).textContent).toContain('Pré-plano')
  })

  it('loads project file content only when the @file thumbnail is opened', async () => {
    vi.mocked(api.readFile).mockResolvedValue({ path:'src/App.tsx', content:'export const ok = true', sha256:'b'.repeat(64), size:22 })
    const directive = parseDirectives('@{[file]src/App.tsx}')[0]
    render(<ComposerReferenceStrip sessionId="ses-1" directives={[directive]} todos={[]} chatFiles={[]} libraryArtifacts={[]} uploads={[]} onRemove={vi.fn()}/>)
    expect(vi.mocked(api.readFile).mock.calls.length).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: /Visualizar App.tsx/i }))
    await waitFor(() => expect(vi.mocked(api.readFile).mock.calls.length).toBe(1))
    expect(screen.getByRole('dialog', { name:'Visualizar referência @file' }).textContent).toContain('export const ok = true')
  })
})

function todo() {
  return { id:'todo-1', project_path:'/work/main', body:'Corrigir fila', status:'open' as const, kind:'improvement' as const, urgency:'normal' as const, description:'Evitar perdas', pre_plan:['persistir estado'], classification_status:'classified' as const, execution_status:'open' as const, created_at:'2026-01-01T00:00:00Z', updated_at:'2026-01-01T00:00:00Z' }
}
