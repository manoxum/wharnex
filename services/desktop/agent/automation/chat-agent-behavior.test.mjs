import test from 'node:test'
import assert from 'node:assert/strict'
import { BEHAVIOR_SCHEMA, baseBehavior, conversationIdFromURL, isTrustedBehaviorURL, mergeBehavior, validateBehavior } from './chat-agent-behavior.mjs'

const BASE = baseBehavior('chatgpt')

test('the builtin behavior is valid and self-describing', () => {
  assert.equal(BASE.schema, BEHAVIOR_SCHEMA)
  assert.equal(BASE.provider, 'chatgpt')
  assert.equal(BASE.origin, 'builtin')
  assert.equal(BASE.revision, '2026-10-08.1')
  assert.throws(() => baseBehavior('some-other-ai'), /No builtin chat-agent behavior/)
})

test('the builtin selectors match what the live ChatGPT DOM actually exposes', () => {
  assert.ok(BASE.selectors.conversationOptionsTrigger.includes('[data-conversation-options-trigger]'))
  assert.ok(BASE.selectors.titleEditor.includes('input[name="title-editor"]'))
  assert.ok(BASE.selectors.projectAnchor.includes('a[role="menuitem"][href^="/g/g-p-"]'))
  assert.ok(BASE.selectors.composer.includes('#prompt-textarea'))
  assert.ok(BASE.selectors.stopButton.includes('button:has(svg.icon-primary-action path[d^="M4.5 5.75"])'))
  assert.deepEqual(BASE.effortLevels.map((level) => level.id), ['instant', 'medium', 'high'])
  assert.ok(BASE.optionalSelectors.effortPicker.includes('[data-composer-surface] button[aria-haspopup="menu"]:not([data-testid])'))
  assert.ok(BASE.optionalSelectors.effortPicker.includes('form[data-chatgpt-composer] button[aria-haspopup="menu"]:not([data-testid])'))
})

test('validation refuses a document that is not this schema', () => {
  const result = validateBehavior({ ...BASE, schema: 'something/v9' })
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /schema must be/)
  assert.equal(result.behavior, undefined)
})

test('validation refuses an empty selector list rather than accepting a blind agent', () => {
  const result = validateBehavior({ ...BASE, selectors: { ...BASE.selectors, composer: [] } })
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /selectors\.composer/)
})

// A zero budget turns a bounded wait into an instant failure; an unbounded one
// hangs the slot forever.
test('validation refuses a timing budget outside the accepted range', () => {
  for (const value of [0, -1, 900_000, Number.NaN]) {
    const result = validateBehavior({ ...BASE, timing: { ...BASE.timing, settleMs: value } })
    assert.equal(result.ok, false, `expected ${value} to be refused`)
  }
})

test('validation refuses a document with no trusted host', () => {
  assert.equal(validateBehavior({ ...BASE, trustedHosts: [] }).ok, false)
})

// A learned overlay must extend the agent's vision, never narrow it: one bad
// learning cycle could otherwise blind it permanently.
test('a learned overlay prepends its selectors and never drops the builtins', () => {
  const merged = mergeBehavior(BASE, { selectors: { composer: ['#new-composer'] }, revision: 'learned-1' })
  assert.equal(merged.ok, true)
  assert.equal(merged.behavior.selectors.composer[0], '#new-composer')
  for (const builtin of BASE.selectors.composer) assert.ok(merged.behavior.selectors.composer.includes(builtin))
  assert.equal(merged.behavior.origin, 'learned')
  assert.equal(merged.behavior.revision, 'learned-1')
})

test('an overlay that tries to empty a selector list keeps the builtins', () => {
  const merged = mergeBehavior(BASE, { selectors: { titleEditor: [] } })
  assert.equal(merged.ok, true)
  assert.deepEqual(merged.behavior.selectors.titleEditor, BASE.selectors.titleEditor)
})

test('an overlay may retune timings within the accepted range and is refused outside it', () => {
  assert.equal(mergeBehavior(BASE, { timing: { settleMs: 900 } }).behavior.timing.settleMs, 900)
  assert.equal(mergeBehavior(BASE, { timing: { settleMs: -5 } }).ok, false)
})

test('a missing overlay leaves the base document untouched', () => {
  const merged = mergeBehavior(BASE, undefined)
  assert.equal(merged.ok, true)
  assert.deepEqual(merged.behavior.selectors.composer, BASE.selectors.composer)
})

test('only https hosts inside the trusted list are accepted', () => {
  assert.equal(isTrustedBehaviorURL(BASE, 'https://chatgpt.com/c/abc'), true)
  assert.equal(isTrustedBehaviorURL(BASE, 'https://sub.chatgpt.com/c/abc'), true)
  assert.equal(isTrustedBehaviorURL(BASE, 'http://chatgpt.com/c/abc'), false)
  assert.equal(isTrustedBehaviorURL(BASE, 'https://chatgpt.com.evil.test/c/abc'), false)
  assert.equal(isTrustedBehaviorURL(BASE, 'not a url'), false)
})

// ChatGPT's transient `/c/WEB:...` creation URLs are not durable conversation
// ids and must never be persisted as affinity.
test('conversation ids come only from a concrete trusted conversation URL', () => {
  assert.equal(conversationIdFromURL(BASE, 'https://chatgpt.com/c/6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f'), '6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f')
  // A conversation moved into a ChatGPT project is served from a project-scoped
  // path; matching only the root form unbinds it the moment the account
  // automation files it under the Wharnex project.
  assert.equal(conversationIdFromURL(BASE, 'https://chatgpt.com/g/g-p-6a9d69a9f3848191ab242df50cbfe9e4-wharnex/c/6aa21a9c-f3bc-83ea-9cba-718a20c1ca25'), '6aa21a9c-f3bc-83ea-9cba-718a20c1ca25')
  assert.equal(conversationIdFromURL(BASE, 'https://chatgpt.com/c/6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f?messageId=finalAgentTurnStart'), '6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f')
  assert.equal(conversationIdFromURL(BASE, 'https://chatgpt.com/c/WEB:pending'), '')
  assert.equal(conversationIdFromURL(BASE, 'https://chatgpt.com/'), '')
  assert.equal(conversationIdFromURL(BASE, 'https://evil.test/c/abc'), '')
})
