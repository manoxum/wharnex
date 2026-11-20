import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { setLocalePreference } from './locale'
import { ProjectTodoEmptyState } from '../../../components/project/tasks/presentation/ProjectTodoEmptyState'
import { SettingsPage } from '../../../components/project/settings/presentation/SettingsPage'
import { AttentionPopover } from '../../../components/attention/center/AttentionPopover'
import { OrchestratorPhaseBadge } from '../../../components/orchestrator/planning/OrchestratorPlanRunSummary'
import { DockerCondition } from '../../../components/docker/services/presentation/DockerCondition'
it('translates tool states and keeps the empty task surface concise and actionable', () => {
  setLocalePreference('en')
  const add = vi.fn()
  render(<><ProjectTodoEmptyState filter="open" onAdd={add}/><OrchestratorPhaseBadge phase="EXECUTING"/><DockerCondition state="running"/></>)
  expect(screen.getByText('No tasks')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
  expect(add).toHaveBeenCalledOnce()
  expect(screen.getAllByText('Running')).toHaveLength(2)
  expect(document.querySelector('[data-empty-state] p')).toBeNull()
})
it('keeps settings introductions available on hover and leaves decision warnings visible', () => {
  render(<SettingsPage title="Appearance" description="Choose a theme"><p role="note">Deleting data is permanent.</p></SettingsPage>)
  expect(screen.getByRole('heading', { name: 'Appearance' }).getAttribute('title')).toBe('Choose a theme')
  expect(screen.queryByText('Choose a theme')).toBeNull()
  expect(screen.getByRole('note').textContent).toBe('Deleting data is permanent.')
})
it('translates notification controls without changing user-authored titles or evidence', () => {
  setLocalePreference('en')
  const action = vi.fn(async () => {})
  render(<AttentionPopover items={[{ id: '1', chatId: 'chat', chatTitle: 'Plano', title: 'Guardar alterações?', detail: 'A mensagem original deve ficar intacta.', tone: 'warning', action: 'approve-execution' }]} activeChatId="chat" busy={false} onOpen={vi.fn(async () => {})} onAction={action} onOpenAll={vi.fn()} onClose={vi.fn()}/>)
  expect(screen.getByRole('dialog', { name: 'Active notifications' })).toBeTruthy()
  expect(screen.getByText('Guardar alterações?')).toBeTruthy()
  expect(screen.getByText('A mensagem original deve ficar intacta.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Approve and run' }))
  expect(action).toHaveBeenCalledOnce()
  expect(screen.queryByText('Items that need attention.')).toBeNull()
})
