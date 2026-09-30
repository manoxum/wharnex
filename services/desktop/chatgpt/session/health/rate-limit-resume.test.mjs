import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTRateLimitResume } from './rate-limit-resume.mjs'

test('rate-limit resume reloads a trusted Worker and confirms the structural gate', async () => {
  const events = []
  const state = { until: 0, resumeProbeRequired: true, resumeProbeNotBefore: 0 }
  const wc = {
    isDestroyed: () => false, getURL: () => 'https://chatgpt.com/c/one',
    reload: () => events.push('reload'), isLoading: () => false,
    executeJavaScript: async () => { events.push('probe'); return { rateLimited: false, required: false } },
  }
  const resume = createChatGPTRateLimitResume({
    state, chatGPTWorkerEntries: [{ slotId: 'worker-1', view: { webContents: wc } }],
    chatGPTKeyForEntry: () => 'chat',
    paceChatGPTWorkerNavigation: async () => events.push('pace'),
    isTrustedChatGPTOrigin: (url) => url.startsWith('https://chatgpt.com/'),
    homeURL: 'https://chatgpt.com/', userAgent: 'test',
    wait: async () => events.push('wait'),
    waitForChatGPTReady: async () => events.push('ready'),
    chatGPTHumanActionScript: () => 'probe-script',
    noteChatGPTRateLimitGate: () => false,
    sanitizeDiagnosticURL: (url) => url,
  })
  assert.equal(await resume.confirmChatGPTRateLimitResume(), true)
  assert.deepEqual(events, ['pace', 'reload', 'wait', 'ready', 'probe'])
  assert.equal(state.resumeProbeRequired, false)
  assert.equal(state.resumeProbeNotBefore, 0)
  assert.equal(resume.chatAgentRateLimitResumeBlocked(), false)
})

test('rate-limit resume waits for a Worker instead of releasing claims blindly', async () => {
  const state = { until: 0, resumeProbeRequired: true, resumeProbeNotBefore: 0 }
  const resume = createChatGPTRateLimitResume({ state, chatGPTWorkerEntries: [] })
  assert.equal(resume.chatAgentRateLimitResumeBlocked(), true)
  await state.resumeProbe
  assert.equal(state.resumeProbeRequired, true)
  assert.ok(state.resumeProbeNotBefore > Date.now())
})
