import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../../../../lib/transport/http/api'
import { ExecutionQueue } from './ExecutionQueue'

vi.mock('../../../../lib/transport/http/api', () => ({ api: { executionConcurrency: vi.fn(async () => ({ concurrency: 2, max: 4 })), updateExecutionConcurrency: vi.fn(async (concurrency: number) => ({ concurrency, max: 4 })) } }))
describe('progressive execution queue', () => {
  it('keeps queue settings available on demand and uses the existing concurrency operation', async () => {
    const { container } = render(<ExecutionQueue items={[]}/>)
    await waitFor(() => expect(api.executionConcurrency).toHaveBeenCalledTimes(1))
    const disclosure = container.querySelector('details')!
    expect(disclosure.open).toBe(false)
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(container.querySelector('summary')!)
    disclosure.open = true
    const select = await screen.findByRole('combobox', { name: 'Execuções simultâneas por projeto' })
    fireEvent.change(select, { target: { value: '3' } })
    await waitFor(() => expect(api.updateExecutionConcurrency).toHaveBeenCalledWith(3))
  })
})
