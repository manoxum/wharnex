import { expect, it, vi } from 'vitest'
import { searchCommands } from './commandSearch'
const commands = [
  { id: 'file', label: 'ação.ts', description: 'src/workspace/ação.ts', group: 'Ficheiros', icon: 'file' as const, run: vi.fn() },
  { id: 'setting', label: 'Definições', description: 'Interface e modelos', group: 'Ações', icon: 'settings' as const, run: vi.fn() },
]
it('matches multiple terms, paths and accents without running an action', () => {
  expect(searchCommands(commands, 'workspace acao')).toEqual([commands[0]])
  expect(searchCommands(commands, 'definicoes')).toEqual([commands[1]])
  expect(searchCommands(commands, 'ficheiros')).toEqual([commands[0]])
  expect(searchCommands(commands, '')).toHaveLength(2)
  expect(commands[0].run).not.toHaveBeenCalled()
})
