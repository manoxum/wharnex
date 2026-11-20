import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { GitUnpushedSection } from './GitUnpushedSection'

afterEach(() => vi.restoreAllMocks())

describe('GitUnpushedSection', () => {
  it('fills the available pending-commits subtab and scrolls its commit list', async () => {
    vi.spyOn(api, 'gitUnpushed').mockResolvedValue({
      branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true,
      commits: [{
        sha: 'abc123', short_sha: 'abc123', subject: 'Improve layout', author_name: 'Dev', author_email: 'dev@example.com',
        committed_at: '2026-10-18T10:00:00Z', parents: [], wharnex: false, merge: false, pushed: false,
      }],
    })

    render(<GitUnpushedSection
      sessionId="session-1" repository="" remotes={[]} disabled={false} fillContainer
      onFullPush={async () => undefined} onSelectedPush={async () => undefined}
    />)

    const list = await screen.findByRole('list')
    expect(list.className).toContain('!min-h-0 !min-w-0 !flex-1 !overflow-y-auto')
    expect(list.parentElement?.className).toContain('!flex !min-h-0 !min-w-0 !flex-1 !flex-col !overflow-hidden')
  })
})
