import type { CodexAsk, CodexBridge, CodexStatus, CodexThread } from '../../src/lib/codex'

export const nativeFixture = new URLSearchParams(window.location.search).has('native')
export function configureNativeFixture(status: CodexStatus, thread: CodexThread) {
  thread.native = true; thread.title = 'Corrigir o retry'; thread.startedAt = new Date().toISOString()
  thread.messages = [{ id: 'user', role: 'user', text: 'Corrige o retry e verifica os testes.' }]
  thread.activities = [
    { id: 'summary', type: 'reasoning', summary: ['A localizar o limite de tentativas antes de alterar o código.'] },
    { id: 'plan', type: 'plan', explanation: 'Verificar a condição de saída e executar os testes focados.', plan: [{ step: 'Inspecionar retry.ts', status: 'completed' }, { step: 'Corrigir e verificar', status: 'inProgress' }] },
    { id: 'command', type: 'commandExecution', command: 'npm test -- retry', aggregatedOutput: '3 testes passaram', exitCode: 0, status: 'completed' },
    { id: 'change', type: 'fileChange', status: 'completed', changes: [{ path: 'src/retry.ts', kind: { type: 'update' }, diff: '+ if (attempt >= retries) break;' }] },
  ]
  status.models[0].supportedReasoningEfforts = [{ reasoningEffort: 'medium', description: 'Medium' }, { reasoningEffort: 'xhigh', description: 'Extra high' }]
  status.models[0].defaultReasoningEffort = 'medium'
  status.accounts = { selected: 'first', profiles: [
    { id: 'first', label: 'Primeira conta', account: status.account, rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: null } },
    { id: 'second', label: 'Segunda conta', account: { type: 'chatgpt', email: 'second@example.test', planType: 'plus' }, rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: null } },
  ] }
  if (new URLSearchParams(window.location.search).has('old-quota')) {
    thread.status = 'attention'; thread.error = "You've hit your usage limit. Try again later."
    thread.messages.push({ id: 'partial', role: 'assistant', text: 'O trabalho começou e ainda há verificações pendentes.' })
    thread.activities = [{ id: 'long-command', type: 'commandExecution', command: Array.from({ length: 150 }, (_, index) => `command step ${index}`).join('\n'), status: 'completed' }]
    delete thread.resumeAvailable; delete thread.pauseReason; delete thread.accountId
  }
  if (new URLSearchParams(window.location.search).has('finalization')) {
    thread.status = 'completed'
    thread.activities?.push({ id: 'native-finalization', type: 'nativeResult', status: 'completed',
      explanation: 'Execução nativa · commit abc123 · versão v1.2.3.5',
      changes: [{ path: 'src/retry.ts', kind: { type: 'update' }, diff: '--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -1 +1 @@\n-before\n+after' }] })
  }
}
export function installNativeActions(bridge: CodexBridge, status: CodexStatus, thread: CodexThread, publish: () => void) {
  bridge.prepareNative = async () => ({ ok: true })
  bridge.answer = async (projectPath, chatId, requestId, askId, answer) => {
    if (projectPath !== thread.projectPath || chatId !== thread.chatId || requestId !== thread.requestId || thread.pendingAsks?.[0]?.id !== askId || !('answers' in answer) || answer.answers.strategy?.answers[0] !== 'Corrigir agora') throw new Error('Resposta não corresponde ao pedido de teste.')
    thread.pendingAsks = []; thread.status = 'completed'; thread.completedAt = new Date().toISOString()
    thread.messages.push({ id: 'reply', role: 'assistant', text: 'Retry corrigido no projeto. Os 3 testes passaram.' }); publish()
    return { ok: true }
  }
  bridge.cancelNativeRequest = async () => { thread.pendingAsks = []; thread.status = 'idle'; publish() }
  bridge.selectAccount = async (_projectPath, id) => {
    const profile = status.accounts?.profiles.find((item) => item.id === id)
    if (!profile || !status.accounts) throw new Error('Conta desconhecida.')
    status.accounts.selected = id; status.account = profile.account; status.rateLimits = profile.rateLimits
  }
  bridge.resumeNative = async (projectPath, chatId, requestId, text) => {
    if (projectPath !== thread.projectPath || chatId !== thread.chatId || requestId !== thread.requestId || status.accounts?.selected !== 'second' || (text !== undefined && !text.trim())) throw new Error('Continuação inválida.')
    thread.status = 'completed'; thread.resumeAvailable = false; thread.requestId = 'req_native_continued'; thread.accountId = 'second'; thread.error = ''
    thread.messages.push({ id: 'continued', role: 'assistant', text: 'Trabalho retomado com a Segunda conta.' }); publish()
  }
}
export function pauseNativeQuota(thread: CodexThread) {
  thread.status = 'attention'; thread.resumeAvailable = true; thread.pauseReason = 'quota'; thread.accountId = 'first'; thread.selfEvolution = true; thread.pendingAsks = []
}
export function askNativeQuestion(thread: CodexThread) {
  const ask: CodexAsk = { id: 'ask-strategy', kind: 'questions', turnId: 'turn-fixture', itemId: 'question', reason: '', command: '', cwd: '', permissions: null, availableDecisions: [], questions: [{ id: 'strategy', header: 'Estratégia', question: 'Como pretende continuar?', options: [{ label: 'Corrigir agora', description: 'Aplicar a correção e verificar os testes.' }, { label: 'Apenas analisar', description: 'Concluir com uma análise.' }] }] }
  thread.pendingAsks = [ask]; thread.status = 'waiting'
}
