import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AutomationHold, AutomationHoldName, AutomationHolds, TaskPolicy } from '../../../../lib/agent/automationHolds'
import { UIAutomationHolds } from './UIAutomationHolds'

const hold = (name: AutomationHoldName, extra: Partial<AutomationHold> = {}): AutomationHold => ({ name, active: false, level: 0, reason: '', source: '', updated_at: '', ...extra })

// A small in-memory backend: task holds decide the UI test policies.
function fakeApi(upload?: AutomationHold) {
  const holds = new Map<AutomationHoldName, AutomationHold>()
  if (upload) holds.set('chatgpt_upload', upload)
  const policy = (type: string): TaskPolicy => {
    const current = holds.get(`task:${type}`) || hold(`task:${type}`)
    return { type, pool: 'worker', uploads: true, state: current.active ? 'suspended' : 'active', hold: current, cooldowns: [] }
  }
  return {
    list: vi.fn(async () => ({ holds: { chatgpt_upload: holds.get('chatgpt_upload') } as AutomationHolds, task_policies: ['UI_TEST_DISCOVER', 'UI_TEST_RUN'].map(policy) })),
    set: vi.fn(async (name: AutomationHoldName, update: { active: boolean }) => { const next = hold(name, update); holds.set(name, next); return next }),
  }
}

describe('UIAutomationHolds', () => {
  it('suspends both UI test types through their task holds and resumes them', async () => {
    const api = fakeApi()
    render(<UIAutomationHolds onError={vi.fn()} api={api}/>)
    fireEvent.click(await screen.findByRole('button', { name: /Suspender testes UI/i }))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('task:UI_TEST_RUN', expect.objectContaining({ active: true })))
    expect(api.set).toHaveBeenCalledWith('task:UI_TEST_DISCOVER', expect.objectContaining({ active: true }))
    expect((await screen.findByRole('status')).textContent).toContain('Testes UI suspensos')
    fireEvent.click(screen.getByRole('button', { name: /Retomar testes UI/i }))
    await waitFor(() => expect(api.set).toHaveBeenLastCalledWith(expect.stringMatching(/^task:UI_TEST_/), { active: false }))
  })

  it('resumes execution when only the run type is suspended', async () => {
    const api = fakeApi()
    await api.set('task:UI_TEST_RUN', { active: true })
    api.set.mockClear()
    render(<UIAutomationHolds onError={vi.fn()} api={api}/>)
    const resume = await screen.findByRole('button', { name: /Retomar testes UI/i })
    expect(screen.getByRole('status').textContent).toContain('Execução suspensa')
    fireEvent.click(resume)
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('task:UI_TEST_RUN', { active: false }))
    expect(api.set).toHaveBeenCalledWith('task:UI_TEST_DISCOVER', { active: false })
  })

  it('shows the account upload limit and lets the operator release it after switching accounts', async () => {
    const api = fakeApi(hold('chatgpt_upload', { active: true, until: new Date(Date.now() + 60 * 60_000).toISOString(), level: 2 }))
    render(<UIAutomationHolds onError={vi.fn()} api={api}/>)
    expect((await screen.findByRole('alert')).textContent).toContain('Limite de upload')
    fireEvent.click(screen.getByRole('button', { name: /Libertar limite/i }))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('chatgpt_upload', { active: false }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('treats an expired upload hold as released', async () => {
    const api = fakeApi(hold('chatgpt_upload', { active: true, until: new Date(Date.now() - 1000).toISOString(), level: 1 }))
    render(<UIAutomationHolds onError={vi.fn()} api={api}/>)
    await screen.findByRole('status')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
