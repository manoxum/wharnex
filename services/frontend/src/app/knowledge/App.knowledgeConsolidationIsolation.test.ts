import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/app/workspace/App.tsx'), 'utf8')

describe('project knowledge consolidation routing', () => {
  it('isolates maintenance from an active request instead of rejecting the action', () => {
    const start = source.indexOf('async function consolidateProjectKnowledge()')
    const end = source.indexOf('\n  async function analyzeEvolutionEvidence', start)
    const body = source.slice(start, end)

    expect(body).toContain('if (requestChainActive(session))')
    expect(body).toContain("api.createSession(session.project_path, executionMode, automationMode, chatId, effortLevel)")
    expect(body).toContain("newWorkspaceChat(created.id, 'Conhecimento · consolidação', chatId)")
    expect(body).toContain('api.saveWorkspaceChat(durableWorkspaceChat(created.project_path, maintenanceChat))')
    expect(body).toContain('setActiveChatId(maintenanceChat.id)')
    expect(body).toContain('api.consolidateProjectKnowledge(targetSession.id)')
    expect(body).not.toContain('Conclua o pedido ativo antes de consolidar o conhecimento do projeto.')
  })
})
