import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupervisorPool } from './pool.mjs'

function fixture({ held = false, visible = false, noWindow = false } = {}) {
  const events = []
  const entry = { view: { webContents: { isDestroyed: () => false, getURL: () => 'https://chatgpt.com/c/1' } } }
  const chatgptViews = new Map(held ? [['other', entry]] : [['chat-1', entry]])
  const pool = createSupervisorPool({
    desktopWindows: new Map(noWindow ? [] : [['main', { window: { isDestroyed: () => false } }]]),
    chatgptViews, touchChatGPTEntry: () => events.push('touch'),
    desiredSupervisorSlots: () => 1, reusableSupervisor: () => ['other', entry],
    chatGPTEntryIsActiveVisible: () => visible,
    ensureChatGPTView: () => { events.push('bind'); return { entry } },
    chatSupervisorStates: new Map(), chatAgentLane: () => 'lane-1',
    sanitizeOptionalChatCacheKey: (value) => value || '', supervisorBindingHeld: () => held,
    chatAgentTaskPayload: () => ({}), sanitizeChatCacheKey: (value) => value || '',
    chatAgentConversationURL: () => 'https://chatgpt.com/c/1',
    CHAT_SUPERVISOR_SLOT_WAIT_MS: 15_000,
    sameConversationURL: (a, b) => a === b,
    loadOwnedChatGPTURL: async () => events.push('navigate'),
    waitForChatGPTSurfaceReady: async () => events.push('ready'),
    isTrustedChatGPTOrigin: () => true, CHATGPT_URL: 'https://chatgpt.com/',
    superviseChatAgentResponse: async () => { events.push('observe'); return { status: 'waiting', observation: true } },
    executeChatAgentWrite: async () => { events.push('write'); return { status: 'done' } },
  })
  return { pool, events, entry }
}

test('resident Supervisor observes its own conversation without navigation', async () => {
  const { pool, events } = fixture()
  const result = await pool.executeChatSupervisorTask({ type: 'AWAIT_RESPONSE', chat_id: 'chat-1' }, { worker: 1 })
  assert.deepEqual(result, { status: 'waiting', observation: true })
  assert.deepEqual(events, ['touch', 'observe'])
})

test('held visible slot returns a free wait instead of evicting it', async () => {
  const { pool, events } = fixture({ held: true, visible: true })
  const result = await pool.executeChatSupervisorTask({ type: 'BOT_WRITE', chat_id: 'chat-1' }, { worker: 1 })
  assert.equal(result.status, 'waiting')
  assert.equal(result.observation, true)
  assert.equal(result.delayMs, 15_000)
  assert.deepEqual(events, [])
})

test('absence of a host window cannot claim or navigate a provider slot', async () => {
  const { pool, events } = fixture({ held: true, noWindow: true })
  const result = await pool.executeChatSupervisorTask({ type: 'BOT_WRITE', chat_id: 'chat-1' }, { worker: 1 })
  assert.equal(result.status, 'waiting')
  assert.equal(result.observation, true)
  assert.deepEqual(events, [])
})
