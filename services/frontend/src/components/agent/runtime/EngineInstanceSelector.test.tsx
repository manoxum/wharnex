import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { supervisorInstanceLabel } from '../../../lib/agent/runtime/engineInstanceLabel'
import { EngineInstanceSelector } from './EngineInstanceSelector'

const worker = {
  id: 'worker-1',
  label: 'Worker 1',
  role: 'worker',
  status: 'idle',
  draining: false,
  chat_id: '',
  error: '',
  browser: { available: true, web_contents_id: 4, url: '', title: '', loading: false },
} as DesktopAgentRuntimeAgent

describe('EngineInstanceSelector', () => {
  it('shows the physical Supervisor assigned to the current chat', () => {
    render(<EngineInstanceSelector supervisorId="supervisor-2" followedAgentId="" workers={[worker]} onSelect={() => undefined} />)
    expect((screen.getByRole('combobox', { name: 'Instância do Engine' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Supervisor 2')
  })

  it('keeps a neutral label until a Supervisor is assigned', () => {
    expect(supervisorInstanceLabel()).toBe('Supervisor')
    expect(supervisorInstanceLabel('worker-2')).toBe('Supervisor')
  })

  it('continues to expose selectable Worker instances', () => {
    const onSelect = vi.fn()
    render(<EngineInstanceSelector supervisorId="supervisor-3" followedAgentId="" workers={[worker]} onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'worker-1' } })
    expect(onSelect).toHaveBeenCalledWith('worker-1')
  })
})
