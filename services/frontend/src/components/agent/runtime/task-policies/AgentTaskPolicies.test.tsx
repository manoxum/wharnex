import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AutomationHold, AutomationHoldName, TaskCooldown, TaskPolicy } from '../../../../lib/agent/automationHolds'
import { AgentTaskPolicies } from './AgentTaskPolicies'

const hold = (name: AutomationHoldName, extra: Partial<AutomationHold> = {}): AutomationHold => ({ name, active: false, level: 0, reason: '', source: '', updated_at: '', ...extra })
const policy = (type: string, pool: TaskPolicy['pool'], extra: Partial<TaskPolicy> = {}): TaskPolicy =>
  ({ type, pool, uploads: false, state: 'active', hold: hold(`task:${type}`), cooldowns: [], ...extra })

function fakeApi(policies: TaskPolicy[]) {
  let current = policies
  return {
    list: vi.fn(async () => ({ holds: {}, task_policies: current })),
    set: vi.fn(async (name: AutomationHoldName, update: { active: boolean }) => {
      current = current.map((item) => `task:${item.type}` === name
        ? { ...item, state: update.active ? 'suspended' : (item.cooldowns.length ? 'cooldown' : 'active'), hold: hold(name, update) }
        : item)
      return hold(name, update)
    }),
  }
}

const until = new Date(Date.now() + 30 * 60_000).toISOString()
const rateLimit: TaskCooldown = { kind: 'rate_limit', until, reason: '429' }

describe('AgentTaskPolicies', () => {
  it('lists every type by category with its state, including types no category names', async () => {
    const api = fakeApi([
      policy('BOT_WRITE', 'supervisor', { uploads: true }),
      policy('RENAME_CHAT', 'worker', { state: 'suspended', hold: hold('task:RENAME_CHAT', { active: true, default: true }) }),
      policy('TODO_CLASSIFY', 'worker', { state: 'cooldown', cooldowns: [rateLimit] }),
      policy('BRAND_NEW_TYPE', 'worker'),
    ])
    render(<AgentTaskPolicies api={api} confirm={() => true}/>)
    const conversation = await screen.findByRole('region', { name: 'Conversa' })
    expect(within(conversation).getByRole('img', { name: 'Ativo' })).toBeTruthy()
    expect(within(conversation).getByLabelText('Envia ficheiros')).toBeTruthy()
    const maintenance = screen.getByRole('region', { name: 'Manutenção de chats' })
    expect(within(maintenance).getByRole('img', { name: 'Suspenso' })).toBeTruthy()
    expect(within(maintenance).getByText('Por omissão · até retomar')).toBeTruthy()
    const utility = screen.getByRole('region', { name: 'Utilitários' })
    expect(within(utility).getByRole('img', { name: 'Cooldown' })).toBeTruthy()
    expect(within(utility).getByText(/^Rate limit · até/)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Outros' })).getByText('BRAND_NEW_TYPE', { selector: 'code' })).toBeTruthy()
  })

  it('suspends until manual resume or for a chosen time, per type and per category', async () => {
    const api = fakeApi([policy('BOT_WRITE', 'supervisor'), policy('RECOVERY_WRITE', 'supervisor'), policy('AWAIT_RESPONSE', 'supervisor')])
    render(<AgentTaskPolicies api={api} confirm={() => true}/>)
    fireEvent.click(await screen.findByRole('button', { name: 'Suspender BOT_WRITE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar suspensão' }))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('task:BOT_WRITE', expect.objectContaining({ active: true, source: 'policies' })))
    expect(api.set.mock.calls[0][1]).not.toHaveProperty('until')

    fireEvent.click(await screen.findByRole('button', { name: 'Suspender RECOVERY_WRITE' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Automática' }))
    fireEvent.click(screen.getByRole('button', { name: '1 h' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar suspensão' }))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('task:RECOVERY_WRITE', expect.objectContaining({ active: true, until: expect.any(String) })))
    const until = Date.parse(String((api.set.mock.calls.at(-1)?.[1] as { until?: string }).until))
    expect(until).toBeGreaterThan(Date.now() + 59 * 60_000)
    expect(until).toBeLessThan(Date.now() + 61 * 60_000)

    fireEvent.click(await screen.findByRole('button', { name: 'Retomar BOT_WRITE' }))
    await waitFor(() => expect(api.set).toHaveBeenLastCalledWith('task:BOT_WRITE', { active: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Suspender todos: Conversa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar suspensão' }))
    expect(await screen.findByRole('button', { name: 'Retomar todos: Conversa' })).toBeTruthy()
  })

  it('refuses an automatic resume without a valid duration', async () => {
    const api = fakeApi([policy('BOT_WRITE', 'supervisor')])
    render(<AgentTaskPolicies api={api} confirm={() => true}/>)
    fireEvent.click(await screen.findByRole('button', { name: 'Suspender BOT_WRITE' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Automática' }))
    fireEvent.change(screen.getByLabelText('Minutos até retomar'), { target: { value: '0' } })
    expect((screen.getByRole('button', { name: 'Confirmar suspensão' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('group', { name: /Suspender/ })).toBeNull()
    expect(api.set).not.toHaveBeenCalled()
  })

  it('releases a cooldown only after confirmation, modal or inline', async () => {
    const releaseRateLimit = vi.fn(async () => undefined)
    const confirm = vi.fn(async () => false)
    const { unmount } = render(<AgentTaskPolicies api={fakeApi([policy('TODO_CLASSIFY', 'worker', { state: 'cooldown', cooldowns: [rateLimit] })])} confirm={confirm} releaseRateLimit={releaseRateLimit}/>)
    fireEvent.click(await screen.findByRole('button', { name: 'Retomar TODO_CLASSIFY' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('rate_limit'))
    expect(releaseRateLimit).not.toHaveBeenCalled()
    unmount()
    render(<AgentTaskPolicies api={fakeApi([policy('TODO_CLASSIFY', 'worker', { state: 'cooldown', cooldowns: [rateLimit] })])} releaseRateLimit={releaseRateLimit}/>)
    fireEvent.click(await screen.findByRole('button', { name: 'Retomar TODO_CLASSIFY' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar libertação' }))
    await waitFor(() => expect(releaseRateLimit).toHaveBeenCalledTimes(1))
  })
})
