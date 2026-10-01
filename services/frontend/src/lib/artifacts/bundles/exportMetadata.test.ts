import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../types'
import { api } from '../../transport/http/api'
import { exportTraceChatItem, exportTraceMarkdownLines, resolveExportTraceMetadata } from './exportMetadata'

vi.mock('../../transport/http/api', () => ({
  api: {
    config: vi.fn(),
    readFile: vi.fn(),
  },
}))

const session = {
  id: 'ses_1', project_path: '/workspace/demo', chat_id: 'chat_1', execution_mode: 'protected', automation_mode: 'auto', state: 'ready', created_at: '2026-09-25T09:00:00Z',
  context: { id: 'ctx_1', workspace_sha256: 'ctx-sha', manifest: { id: 'ctx_1', project_root: '/workspace/demo', sha256: 'manifest-sha', files: [], excluded: [], text_truncated: false } },
  last_request_id: 'req_child', wharnex_instance_id: 'office', request_lineages: { req_child: { request_id: 'req_child', root_request_id: 'req_root', kind: 'repair', created_at: '2026-09-25T09:30:00Z' } },
} as Session

describe('export trace metadata', () => {
  beforeEach(() => {
    vi.mocked(api.config).mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: 'test', version: 'v1.3.17.1', api_configured: false, chatgpt_web_embed: false })
    vi.mocked(api.readFile).mockResolvedValue({ path: 'VERSION', content: 'v4.5.6.7\n', sha256: 'version-sha', size: 9 })
  })

  it('resolves current Wharnex/project versions and request lineage', async () => {
    const metadata = await resolveExportTraceMetadata(session, { kind: 'subplan', requestId: 'req_child', planId: 'plan_1' })
    expect(metadata.wharnex_version).toBe('v1.3.17.1')
    expect(metadata.project_version).toBe('v4.5.6.7')
    expect(metadata.root_request_id).toBe('req_root')
    expect(metadata.plan_id).toBe('plan_1')
    expect(metadata.context_sha256).toBe('ctx-sha')
  })

  it('renders trace fields for Markdown and chat export without mutating the live transcript', () => {
    const metadata = {
      schema: 'wharnex.export-metadata/v1' as const, created_at: '2026-09-25T09:47:55.822Z', export_kind: 'chat' as const,
      wharnex_version: 'v1.3.17.1', project_version: 'v4.5.6.7', project_path: '/workspace/demo', session_id: 'ses_1', chat_id: 'chat_1', root_request_id: 'req_root', request_id: 'req_child', context_id: 'ctx_1', context_sha256: 'ctx-sha',
    }
    const markdown = exportTraceMarkdownLines(metadata).join('\n')
    const item = exportTraceChatItem(metadata)
    expect(markdown).toContain('Schema de metadados: wharnex.export-metadata/v1')
    expect(markdown).toContain('Data de criação: 2026-09-25T09:47:55.822Z')
    expect(markdown).toContain('Versão do Wharnex: v1.3.17.1')
    expect(markdown).toContain('Versão do projeto: v4.5.6.7')
    expect(item.source).toBe('wharness')
    expect(item.presentation).toBe('notice')
    expect(item.text).toContain('Main Request: `req_root`')
  })
})
