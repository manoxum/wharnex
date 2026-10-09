import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { saveBoundActiveProject, saveBoundProjects } from '../../../lib/project/context/projectBindings'
import { WorkspaceShell } from '../shell/WorkspaceShell'

beforeEach(() => { localStorage.clear(); delete window.wharnessDesktop })
afterEach(() => { vi.restoreAllMocks(); delete window.wharnessDesktop })

describe('WorkspaceShell project actions', () => {
it('emphasizes the active project when its embedded composer reports typing', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: false, chatgpt_web_embed: true })
    saveBoundProjects(['/tmp/active-project'])
    saveBoundActiveProject('/tmp/active-project')
    window.wharnessDesktop = {
      projects: { acquire: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/active-project' }) },
    } as unknown as WharnessDesktopBridge

    render(<WorkspaceShell />)
    const frame = await screen.findByTitle('Wharnex · active-project') as HTMLIFrameElement
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { type: 'wharness:composer-typing', projectPath: '/tmp/active-project' },
    }))

    const activeProject = screen.getByTitle('/tmp/active-project · clique para ver projetos abertos')
    await waitFor(() => expect(activeProject.className).toContain('animate-[wharnex-project-composer-pulse_.9s_ease-in-out_infinite]'))
    expect(activeProject.className).toContain('motion-reduce:animate-none')
  })

})
