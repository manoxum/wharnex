import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatGPTSubmitCoordinator, dispatchChatGPTComposerClick, dispatchChatGPTSubmit, submitWithRetry, submitWithoutReplay } from './chatgpt-input.mjs'

const conversationURL = 'https://chatgpt.com/backend-api/f/conversation/prepare'

test('ChatGPT submit uses a layout-independent native Enter key without stealing WebContents focus', () => {
  const events = []
  let focused = 0
  const webContents = {
    focus() { focused += 1 },
    sendInputEvent(event) { events.push(event) },
  }

  const result = dispatchChatGPTSubmit(webContents)

  assert.equal(focused, 0)
  assert.deepEqual(result, { method: 'native-enter' })
  assert.deepEqual(events, [
    { type: 'keyDown', keyCode: 'Enter' },
    { type: 'keyUp', keyCode: 'Enter' },
  ])
})

test('automatic submit retries until ChatGPT starts the conversation request', async () => {
  const coordinator = new ChatGPTSubmitCoordinator()
  let submitCount = 0

  const result = await submitWithRetry({
    attempts: 3,
    beforeAttempt: async () => {},
    beginSubmission: () => coordinator.expect(42, { startTimeoutMs: 2 }),
    submit: () => {
      submitCount += 1
      if (submitCount === 2) {
        coordinator.onBeforeRequest({ id: 91, method: 'POST', webContentsId: 42, url: conversationURL })
      }
    },
    wait: async () => {},
  })

  assert.equal(submitCount, 2)
  assert.deepEqual(result, { accepted: true, requestId: '91' })
})

test('automatic submit defaults beforeAttempt to a no-op instead of crashing when a caller omits it', async () => {
  const coordinator = new ChatGPTSubmitCoordinator()
  let submitCount = 0

  const result = await submitWithRetry({
    attempts: 3,
    beginSubmission: () => coordinator.expect(43, { startTimeoutMs: 2 }),
    submit: () => {
      submitCount += 1
      coordinator.onBeforeRequest({ id: 92, method: 'POST', webContentsId: 43, url: conversationURL })
    },
    wait: async () => {},
  })

  assert.equal(submitCount, 1)
  assert.deepEqual(result, { accepted: true, requestId: '92' })
})

test('automatic submit rejects after confirmation attempts are exhausted', async () => {
  const coordinator = new ChatGPTSubmitCoordinator()
  let submitCount = 0

  await assert.rejects(() => submitWithRetry({
    attempts: 2,
    beforeAttempt: async () => {},
    beginSubmission: () => coordinator.expect(8, { startTimeoutMs: 1 }),
    submit: () => { submitCount += 1 },
    wait: async () => {},
  }), /not accepted after 2 attempts/)

  assert.equal(submitCount, 2)
})


test('automatic submit never replays Enter when request observation times out', async () => {
  const coordinator = new ChatGPTSubmitCoordinator()
  let submitCount = 0

  const result = await submitWithoutReplay({
    beginObservation: () => coordinator.expect(17, { startTimeoutMs: 1 }),
    submit: () => { submitCount += 1 },
  })

  assert.equal(submitCount, 1)
  assert.deepEqual(result, {
    accepted: false,
    requestId: '',
    observationError: 'ChatGPT did not accept the submit command before timeout',
  })
})

test('automatic submit still reports a confirmed observed request when available', async () => {
  const coordinator = new ChatGPTSubmitCoordinator()
  let submitCount = 0

  const result = await submitWithoutReplay({
    beginObservation: () => coordinator.expect(23, { startTimeoutMs: 100 }),
    submit: () => {
      submitCount += 1
      coordinator.onBeforeRequest({ id: 123, method: 'POST', webContentsId: 23, url: conversationURL })
    },
  })

  assert.equal(submitCount, 1)
  assert.deepEqual(result, { accepted: true, requestId: '123' })
})


test('ChatGPT composer targeting does not call WebContents focus or move the OS pointer', () => {
  const events = []
  let focused = 0
  const webContents = {
    focus() { focused += 1 },
    sendInputEvent(event) { events.push(event) },
  }
  const point = dispatchChatGPTComposerClick(webContents, { x: 320.9, y: 640.2 })
  assert.equal(focused, 0)
  assert.deepEqual(point, { x: 320, y: 640 })
  assert.deepEqual(events, [
    { type: 'mouseDown', x: 320, y: 640, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x: 320, y: 640, button: 'left', clickCount: 1 },
  ])
})
