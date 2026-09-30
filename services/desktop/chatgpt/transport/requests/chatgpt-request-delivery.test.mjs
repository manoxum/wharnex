import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyChatGPTRequestDelivery } from './chatgpt-request-delivery.mjs'

const task = (status, type = 'BOT_WRITE', chatId = 'chat-1') => ({ status, type, chat_id: chatId })

test('classifies an active write as not yet submitted', () => {
  assert.equal(classifyChatGPTRequestDelivery([task('RUNNING')], 'chat-1'), 'writing')
})

test('classifies a terminal write without DONE as requiring a full resend', () => {
  assert.equal(classifyChatGPTRequestDelivery([task('FAILED')], 'chat-1'), 'not_submitted')
})

test('DONE is durable evidence that response supervision may resume', () => {
  assert.equal(classifyChatGPTRequestDelivery([task('FAILED'), task('DONE')], 'chat-1'), 'submitted')
})

test('ignores writes owned by another immutable chat affinity', () => {
  assert.equal(classifyChatGPTRequestDelivery([task('RUNNING', 'BOT_WRITE', 'chat-2')], 'chat-1'), 'untracked')
})
