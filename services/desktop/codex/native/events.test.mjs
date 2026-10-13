import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeEvents } from './events.mjs'

test('activity streams public summaries, plan and command output, excluding raw reasoning', async () => {
  const record = { threadId: 'thread', turnId: 'turn', status: 'running', messages: [], activities: [] }
  const ledger = []
  const events = createNativeEvents({ find: () => record, save: async () => {}, publish() {},
    journal: { append: async (_record, method, params) => ledger.push({ method, params }), sanitize: (value) => value }, interactions: { retire() {} } })
  const scope = { threadId: 'thread', turnId: 'turn' }
  await events('item/reasoning/textDelta', { ...scope, delta: 'raw hidden reasoning' })
  await events('item/reasoning/summaryTextDelta', { ...scope, itemId: 'summary', summaryIndex: 0, delta: 'A verificar os testes públicos.' })
  await events('turn/plan/updated', { ...scope, explanation: 'Corrigir a regressão.', plan: [{ step: 'Executar testes', status: 'inProgress' }] })
  await events('item/started', { ...scope, item: { id: 'cmd', type: 'commandExecution', command: 'npm test', status: 'inProgress' } })
  await events('item/commandExecution/outputDelta', { ...scope, itemId: 'cmd', delta: '3 passed' })
  await events('item/autoApprovalReview/completed', { ...scope, reviewId: 'review', review: { status: 'approved', riskLevel: 'low', rationale: 'A alteração está limitada ao projeto.' } })
  assert.equal(record.activities[0].summary[0], 'A verificar os testes públicos.')
  assert.equal(record.activities[1].plan[0].step, 'Executar testes')
  assert.equal(record.activities[2].aggregatedOutput, '3 passed')
  assert.equal(record.activities[3].type, 'approvalReview'); assert.equal(record.activities[3].explanation, 'A alteração está limitada ao projeto.')
  assert.doesNotMatch(JSON.stringify(ledger), /raw hidden reasoning/)
})
test('a non-retrying quota error exposes recovery immediately and still records its terminal turn', async () => {
  const record = { native: true, threadId: 'thread', turnId: 'turn', status: 'running', requestId: 'req_test', messages: [], activities: [] }
  const ledger = []
  const events = createNativeEvents({ find: () => record, save: async () => {}, publish() {}, journal: { append: async (_record, method) => ledger.push(method), sanitize: (value) => value, settle: async () => {} }, interactions: { retire() {} } })
  const error = { message: "You've hit your usage limit.", codexErrorInfo: 'usageLimitExceeded' }
  await events('error', { threadId: 'thread', turnId: 'turn', willRetry: true, error })
  assert.equal(record.status, 'running')
  await events('error', { threadId: 'thread', turnId: 'turn', willRetry: false, error })
  assert.equal(record.status, 'attention'); assert.equal(record.resumeAvailable, true); assert.equal(record.pauseReason, 'quota')
  const recorded = ledger.length
  await events('turn/completed', { threadId: 'thread', turn: { id: 'older-turn', status: 'completed' } })
  assert.equal(ledger.length, recorded); assert.equal(record.status, 'attention')
  await events('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'failed', error } })
  assert.ok(record.completedAt); assert.equal(ledger.at(-1), 'turn/completed')
})
test('quota and context failures enable manual continuation with distinct reasons and no replay', async () => {
  for (const [code, reason] of [['usageLimitExceeded', 'quota'], ['rateLimitExceeded', 'quota'], ['contextWindowExceeded', 'context'], ['sessionBudgetExceeded', 'context']]) {
    const record = { threadId: 'thread', turnId: 'turn', status: 'running', requestId: 'req_test', messages: [], activities: [] }
    const ledger = []
    const events = createNativeEvents({ find: () => record, save: async () => {}, publish() {},
      journal: { append: async (_record, method) => ledger.push(method), sanitize: (value) => value, settle: async () => {} }, interactions: { retire() {} } })
    await events('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'failed', error: { message: 'Native limit reached.', codexErrorInfo: code } } })
    assert.equal(record.status, 'attention'); assert.equal(record.resumeAvailable, true); assert.equal(record.pauseReason, reason)
    assert.deepEqual(ledger, ['turn/completed'])
  }
})
