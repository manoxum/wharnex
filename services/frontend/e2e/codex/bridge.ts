import type { CodexBridge, CodexStatus, CodexThread } from '../../src/lib/codex'
import { askNativeQuestion, configureNativeFixture, installNativeActions, nativeFixture, pauseNativeQuota } from './nativeFixture'
const tokens = { totalTokens: 12840, inputTokens: 9200, cachedInputTokens: 4600, outputTokens: 3640, reasoningOutputTokens: 2048 }
const thread: CodexThread = { projectPath: '/workspace/wharnex', chatId: 'chat-parser', threadId: 'thread-fixture', requestId: 'request-fixture', title: 'Rever a validação dos bundles', model: 'fixture-model', status: 'running', error: '', tokenUsage: { total: tokens, last: tokens, modelContextWindow: 272000 }, messages: [{ id: 'reply', text: 'A analisar a validação dos bundles e o fluxo de execução.\n\n- Contexto do projeto recebido.\n- Isolamento Protected preservado.\n- A preparar o plano para validação.' }] }
const status: CodexStatus = { connected: true, account: { type: 'chatgpt', email: 'developer@example.test', planType: 'plus' }, rateLimits: { primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 38, windowDurationMins: 10080, resetsAt: 1800200000 } }, usage: null, models: [{ id: 'fixture-model', model: 'fixture-model', label: 'Modelo de teste', isDefault: true }], threads: [thread] }
const listeners = new Set<(thread: CodexThread) => void>()
const codex: CodexBridge = {
  status: async () => status, threads: async () => status.threads, history: async () => thread,
  login: async () => ({ started: true }), logout: async () => {}, preparePrompt: async () => ({ ok: true }),
  cancelRequest: async () => {}, pendingBundles: async () => [], acknowledge: async () => {},
  subscribe: async () => {}, unsubscribe: async () => {},
  onEvent: (callback) => { listeners.add(callback); return () => { listeners.delete(callback) } }, onBundle: () => () => {},
}
const publish = () => { for (const listener of listeners) listener({ ...thread }) }
export function installFixtureBridge() {
  if (nativeFixture) { configureNativeFixture(status, thread); installNativeActions(codex, status, thread, publish) }
  Object.defineProperty(window, 'wharnessDesktop', { value: { codex }, configurable: true })
}
export function requestFixtureAnswer() { askNativeQuestion(thread); publish() }
export function pauseFixtureQuota() { pauseNativeQuota(thread); publish() }
export function completeFixtureTurn() {
  thread.status = 'idle'; thread.messages = [{ id: 'reply', text: 'Validação concluída. O plano segue para o Wharnex.\n\n```typescript\nvalidateBundle(response)\n```\n\nO resultado e as alterações ficam disponíveis no chat e no plano.' }]
  for (const listener of listeners) listener({ ...thread })
}
