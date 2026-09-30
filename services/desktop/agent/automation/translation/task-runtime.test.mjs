import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranslatorTaskRuntime } from './task-runtime.mjs'

function fixture({ borrow = false, failLoad = false } = {}) {
  const events = []
  const entry = { slotId: 'translator-1' }
  const chatGPTWorkerEntries = borrow ? [] : [entry]
  const context = {
    desktopWindows: new Map([['main', { window: { isDestroyed: () => false } }]]),
    createChatGPTWorkerView: (id) => { events.push(`create:${id}`); return entry },
    publishChatAgentRuntimeState: () => events.push('publish'),
    chatAgentTaskPayload: () => ({ kind: 'translation' }),
    assignChatGPTWorker: () => ({ key: 'chat-1', assignment: { epoch: 7 } }),
    loadAndSettleChatGPTWorkerConversation: async () => {
      events.push('load')
      if (failLoad) throw new Error('load failed')
    },
    CHATGPT_URL: 'https://chatgpt.com/',
    executeChatAgentMarkdownTranslation: async () => { events.push('translate'); return { status: 'done' } },
    chatAgentResidency: {
      cancelAssignment: (id, epoch) => events.push(`cancel:${id}:${epoch}`),
      releaseResidentLane: (id) => events.push(`release:${id}`),
    },
    chatGPTWorkerEntries,
    retireChatGPTWorkerView: () => events.push('retire'),
  }
  return { runtime: createTranslatorTaskRuntime(context), events, entry, chatGPTWorkerEntries }
}

test('translation rejects foreign tasks before opening a provider view', async () => {
  const { runtime, events } = fixture()
  assert.equal((await runtime.executeChatTranslatorTask({ type: 'BOT_WRITE' })).status, 'failed')
  assert.deepEqual(events, [])
})

test('one-shot Translator retires its view after successful delivery', async () => {
  const { runtime, events, chatGPTWorkerEntries } = fixture()
  const result = await runtime.executeChatTranslatorTask({ type: 'TRANSLATE_MARKDOWN', task_id: '1' })
  assert.equal(result.status, 'done')
  assert.deepEqual(events.filter((event) => ['load', 'translate', 'retire'].includes(event)), ['load', 'translate', 'retire'])
  assert.equal(chatGPTWorkerEntries.length, 0)
})

test('borrowed Worker releases its lane and cancels failed assignment', async () => {
  const { runtime, events, entry } = fixture({ borrow: true, failLoad: true })
  const result = await runtime.executeChatTranslatorTask({ type: 'TRANSLATE_MARKDOWN', task_id: '1' }, { entry })
  assert.deepEqual(result, { status: 'failed', error: 'load failed' })
  assert.deepEqual(events, ['load', 'cancel:translator-1:7', 'release:translator-1'])
})
