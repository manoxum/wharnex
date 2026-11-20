import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ProjectTodo } from '../../../../types'
import { setLocalePreference } from '../../../../lib/workspace/localization'
import { TodoCard } from './TodoCard'

const todo = {
  id: 'todo-1', body: 'Guardar', status: 'open', kind: 'improvement', urgency: 'very_urgent',
  classification_status: 'classified', description: 'A descrição original.', pre_plan: ['Rever execução'],
  execution_status: 'processing', execution_chat_id: 'chat-1', created_at: '2026-10-16T10:00:00Z',
  project_files: ['src/Guardar.tsx'],
} as ProjectTodo

it('localizes task controls and classifications while preserving user content and actions', () => {
  setLocalePreference('en')
  const actions = { onStatus: vi.fn(), onRetry: vi.fn(), onChat: vi.fn(), onCurrentChat: vi.fn(), onLocate: vi.fn(), onOrchestrator: vi.fn(), onDelete: vi.fn() }
  render(<TodoCard todo={todo} busy={false} {...actions}/>)
  expect(screen.getByText('Improvement')).toBeTruthy()
  expect(screen.getByText('Very urgent')).toBeTruthy()
  expect(screen.getByText('Running')).toBeTruthy()
  expect(screen.getByText('Guardar')).toBeTruthy()
  expect(screen.getByText('A descrição original.')).toBeTruthy()
  expect(screen.getByText('Rever execução')).toBeTruthy()
  expect(screen.getByText('src/Guardar.tsx')).toBeTruthy()
  for (const [label, callback] of [['New chat', actions.onChat], ['Current chat', actions.onCurrentChat], ['Locate chat', actions.onLocate], ['Complete', actions.onStatus], ['Delete task', actions.onDelete], ['Orchestrator', actions.onOrchestrator]] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(callback).toHaveBeenCalledOnce()
  }
  act(() => setLocalePreference('pt'))
  expect(screen.getByRole('button', { name: 'Novo chat' })).toBeTruthy()
  expect(screen.getByText('Muito urgente')).toBeTruthy()
  expect(screen.getByText('Guardar')).toBeTruthy()
})

it('keeps busy actions disabled and provides a translated classification retry', () => {
  setLocalePreference('en')
  const retry = vi.fn()
  const props = { ...todo, classification_status: 'failed' as const }
  const callbacks = { onStatus: vi.fn(), onRetry: retry, onChat: vi.fn(), onCurrentChat: vi.fn(), onLocate: vi.fn(), onOrchestrator: vi.fn(), onDelete: vi.fn() }
  const view = render(<TodoCard todo={props} busy {...callbacks}/>)
  expect(screen.getByText('Analysis pending')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(retry).not.toHaveBeenCalled()
  view.rerender(<TodoCard todo={props} busy={false} {...callbacks}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(retry).toHaveBeenCalledOnce()
})
