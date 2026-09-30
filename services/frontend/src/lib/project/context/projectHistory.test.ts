import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('../../transport/http/api', () => ({ request: requestMock }))

import { rememberOpenedProject, syncOpenedProjectHistory } from './projectHistory'

beforeEach(() => requestMock.mockReset().mockResolvedValue(undefined))

describe('project history', () => {
  it('records a canonical Desktop project independently from sessions', async () => {
    await rememberOpenedProject('/work/core')
    expect(requestMock).toHaveBeenCalledWith('/api/projects/history', {
      method: 'POST',
      body: JSON.stringify({ project_path: '/work/core' }),
    })
  })

  it('deduplicates legacy recent projects and treats migration as best effort', async () => {
    requestMock.mockRejectedValueOnce(new Error('backend unavailable'))
    await expect(syncOpenedProjectHistory(['/work/a', '/work/a', ' /work/b '])).resolves.toBeUndefined()
    expect(requestMock).toHaveBeenCalledTimes(2)
  })
})
