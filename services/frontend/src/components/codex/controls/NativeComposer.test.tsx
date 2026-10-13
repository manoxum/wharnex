import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatPanel } from '../../chat/panel/ChatPanel'
import { session, chatActions } from '../../chat/panel/testing/panelTestFixtures'

vi.mock('../../../lib/codex', async (original) => ({ ...await original<typeof import('../../../lib/codex')>(), useCodexStatus: () => ({ data: { models: [{ model: 'native-model', label: 'Native Model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'xhigh', description: 'Deep' }] }] } }) }))
afterEach(cleanup)
it('native composer shows runtime effort and attachment controls while hiding Wharnex planner options', () => {
  const onCodexEffort = vi.fn(), onCodexPermission = vi.fn()
  render(<ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} engine="codex" codexModel="native-model" onCodexEffort={onCodexEffort} onCodexPermission={onCodexPermission} attachmentsEnabled onSend={async () => {}} {...chatActions}/>)
  for (const label of ['Contexto ZIP', 'Prompt', 'Resultado', 'Erro', 'Pré-visualizar próximo bundle', 'Planificar antes de alterar', 'Conhecimento do projeto', 'Modo interativo', 'Protected', 'Unprotected', 'Full', 'Auto', 'Auto + Aprovar']) expect(screen.queryByRole('button', { name: label })).toBeNull()
  for (const label of ['Nível de esforço', 'Esforço de raciocínio', 'Modo de contexto']) expect(screen.queryByLabelText(label)).toBeNull()
  expect(screen.getByRole('button', { name: 'Anexar ficheiros' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Modelo Codex' })).toBeTruthy()
  const effort = screen.getByRole('combobox', { name: 'Esforço Codex' })
  expect(effort.textContent).toContain('xhigh')
  expect(effort.textContent).not.toContain('Loop')
  fireEvent.change(effort, { target: { value: 'xhigh' } })
  expect(onCodexEffort).toHaveBeenCalledWith('xhigh')
  fireEvent.change(screen.getByRole('combobox', { name: 'Permissões Codex' }), { target: { value: 'ask' } })
  expect(onCodexPermission).toHaveBeenCalledWith('ask')
})
