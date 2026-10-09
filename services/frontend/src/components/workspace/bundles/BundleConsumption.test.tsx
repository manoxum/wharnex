import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BundleQuota } from '../../../types'
import { WorkbenchStatusBar } from '../shell/WorkbenchStatusBar'

const mocks = vi.hoisted(() => ({ bundleQuota: vi.fn() }))
vi.mock('../../../lib/transport/http/api', () => ({ api: { bundleQuota: mocks.bundleQuota } }))

const quota: BundleQuota = {
  window_hours: 3, limit: 80, sent: 135, received: 129, total: 264, warning: true,
  window_start: '2026-10-06T11:57:23Z', window_end: '2026-10-06T14:57:23Z', source: 'transport', estimated_received: 128,
  by_task_type: [
    { type: 'UI_TEST_RUN', sent: 134, received: 128, total: 262, estimated_received: 128 },
    { type: 'UI_TEST_DISCOVER', sent: 1, received: 1, total: 2, estimated_received: 0 },
  ],
}

function renderFooter() {
  return render(<WorkbenchStatusBar mode="agent" executionMode="protected" automationMode="manual" terminalOpen={false} activeExecutions={0}/>)
}

describe('lower-right workspace bundle counter', () => {
  beforeEach(() => {
    mocks.bundleQuota.mockReset().mockResolvedValue(quota)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('opens the task breakdown from the footer and reconciles sent, received and totals', async () => {
    renderFooter()
    const counter = await screen.findByRole('button', { name: 'Bundles nas últimas 3 horas' })
    counter.focus()
    fireEvent.click(counter)
    const popup = screen.getByRole('dialog', { name: 'Bundles nas últimas 3 horas' })
    const rows = within(popup).getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(within(rows[1]).getByText('UI_TEST_RUN')).toBeTruthy()
    expect(within(rows[1]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['134', '128*', '262'])
    expect(within(rows[3]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['135', '129', '264'])
    expect(within(popup).getByText(/128 recebidos estimados/)).toBeTruthy()
    expect(mocks.bundleQuota).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(popup, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(counter)
  })

  it('keeps unknown task types visible and handles an empty window', async () => {
    mocks.bundleQuota.mockResolvedValue({ ...quota, sent: 1, received: 0, total: 1, warning: false, estimated_received: 0, by_task_type: [{ type: 'NEW_TASK', sent: 1, received: 0, total: 1, estimated_received: 0 }] })
    renderFooter()
    fireEvent.click(await screen.findByRole('button', { name: 'Bundles nas últimas 3 horas' }))
    expect(screen.getAllByText('NEW_TASK').length).toBeGreaterThan(0)
    mocks.bundleQuota.mockResolvedValue({ ...quota, sent: 0, received: 0, total: 0, warning: false, estimated_received: 0, by_task_type: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByText('Sem detalhe por tarefa nesta janela.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a failed refresh without replacing the last known counts with zero', async () => {
    renderFooter()
    const counter = await screen.findByRole('button', { name: 'Bundles nas últimas 3 horas' })
    mocks.bundleQuota.mockRejectedValue(new Error('unavailable'))
    await act(async () => { fireEvent.click(counter) })
    expect(screen.getByRole('alert').textContent).toContain('última consulta bem-sucedida')
    expect(counter.textContent).toContain('135/80')
  })

  it('explains missing task breakdowns from an older service without hiding the known totals', async () => {
    mocks.bundleQuota.mockResolvedValue({ ...quota, sent: 1, received: 0, total: 1, warning: false, by_task_type: undefined, source: undefined, estimated_received: undefined })
    renderFooter()
    fireEvent.click(await screen.findByRole('button', { name: 'Bundles nas últimas 3 horas' }))
    const popup = screen.getByRole('dialog', { name: 'Bundles nas últimas 3 horas' })
    expect(within(popup).getByRole('status').textContent).toContain('Atualize o Wharnex')
    expect(within(popup).queryByText('Sem detalhe por tarefa nesta janela.')).toBeNull()
    const total = within(popup).getAllByRole('row').at(-1)!
    expect(within(total).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '0', '1'])
    mocks.bundleQuota.mockResolvedValue({ ...quota, sent: 1, received: 0, total: 1, warning: false, estimated_received: 0, by_task_type: [{ type: 'BOT_WRITE', sent: 1, received: 0, total: 1, estimated_received: 0 }] })
    fireEvent.click(within(popup).getByRole('button', { name: 'Atualizar' }))
    expect(await within(popup).findByText('BOT_WRITE')).toBeTruthy()
    expect(within(popup).queryByRole('status')).toBeNull()
  })
})
