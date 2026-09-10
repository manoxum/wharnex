import test from 'node:test'
import assert from 'node:assert/strict'
import { baseBehavior } from './chat-agent-behavior.mjs'
import {
  anomalyCaptureScript,
  composerStateScript,
  fillComposerScript,
  inspectScript,
  menuItemRectScript,
  openConversationMenuScript,
  projectItemRectScript,
  readinessScript,
  reasoningDisclosureRectScript,
  reasoningRowsScript,
  titleEditorScript,
} from './chat-agent-scripts.mjs'

const BASE = baseBehavior('chatgpt')

const ALL = [
  readinessScript(BASE),
  inspectScript(BASE),
  fillComposerScript(BASE, 'olá'),
  composerStateScript(BASE),
  openConversationMenuScript(BASE, 'conv-1'),
  menuItemRectScript(BASE, 'rename'),
  projectItemRectScript(BASE, 'wharnex'),
  titleEditorScript(BASE, 'WHX: teste'),
  reasoningDisclosureRectScript(BASE),
  reasoningRowsScript(BASE),
  anomalyCaptureScript(BASE),
]

test('every script is a self-contained expression carrying its own behavior context', () => {
  for (const script of ALL) {
    assert.match(script, /^\(\(\) => \{ const __whx = \{/)
    assert.match(script, /\}\)\(\)$/)
  }
})

// The whole point of the behavior document is that no selector is compiled in.
test('scripts take their selectors from the injected behavior, not from literals', () => {
  const script = openConversationMenuScript(BASE, 'conv-1')
  assert.match(script, /S\.conversationOptionsTrigger/)
  assert.match(script, /S\.conversationOptionsHeader/)
  // The selector itself arrives through the injected context, not as a literal
  // in the control flow.
  assert.ok(script.includes('"conversationOptionsTrigger":["[data-conversation-options-trigger]"]'))
})

test('a different behavior document produces different scripts', () => {
  const custom = { ...BASE, selectors: { ...BASE.selectors, composer: ['#other-composer'] } }
  assert.match(fillComposerScript(custom, 'x'), /#other-composer/)
  assert.doesNotMatch(fillComposerScript(custom, 'x'), /#prompt-textarea/)
})

test('locating scripts return a rect and never click the control themselves', () => {
  for (const script of [menuItemRectScript(BASE, 'archive'), projectItemRectScript(BASE, 'wharnex'), reasoningDisclosureRectScript(BASE)]) {
    assert.match(script, /rect\(/)
    assert.doesNotMatch(script, /\.click\(\)/)
  }
})

test('the conversation menu trigger is the one control a script may click', () => {
  assert.match(openConversationMenuScript(BASE, 'conv-1'), /trigger\.click\(\)/)
})

// Inspection classifies structurally so it can tell "finished" from "still
// generating" without reading what was generated.
test('inspection reports a structural state and never reads assistant prose', () => {
  const script = inspectScript(BASE)
  assert.match(script, /state: stop \? 'generating'/)
  assert.doesNotMatch(script, /\.markdown/)
  assert.doesNotMatch(script, /textContent\s*\|\|\s*''\s*\)\.slice\(0, 4000\)/)
})

test('reasoning extraction refuses to read a collapsed disclosure', () => {
  const script = reasoningRowsScript(BASE)
  assert.match(script, /state: 'reasoning-collapsed'/)
  assert.match(script, /aria-expanded/)
})

// Code blocks are excluded structurally, by container, not by inspecting text.
test('reasoning extraction excludes code and markdown regions structurally', () => {
  const script = reasoningRowsScript(BASE)
  for (const selector of BASE.reasoning.excludeWithin) assert.ok(script.includes(JSON.stringify(selector).slice(1, -1)), `missing exclusion ${selector}`)
  assert.match(script, /const isCode =/)
  assert.match(script, /if \(isCode\(node\)\) continue/)
})

test('reasoning extraction is bounded by row count and row length', () => {
  const script = reasoningRowsScript(BASE)
  assert.match(script, /rows\.length >= cfg\.maxRows/)
  assert.match(script, /value\.length < cfg\.minRowChars \|\| value\.length > cfg\.maxRowChars/)
  assert.equal(BASE.reasoning.maxRows, 40)
})

test('a disabled reasoning capability short-circuits the extractor', () => {
  const disabled = { ...BASE, reasoning: { ...BASE.reasoning, enabled: false } }
  assert.match(reasoningRowsScript(disabled), /if \(!cfg\.enabled\) return \{ ok: false, state: 'reasoning-disabled' \}/)
})

// An anomaly snapshot exists to evolve the behavior document, so it must carry
// structure without carrying conversation content.
test('anomaly capture records attributes and structure but no conversation text', () => {
  const script = anomalyCaptureScript(BASE)
  assert.match(script, /attrs\[a\.name\]/)
  // The described node carries structure only: tag, attributes, children. A
  // snapshot kept for behavior evolution must never become a transcript.
  assert.match(script, /return \{ tag: node\.tagName\.toLowerCase\(\), attrs, children:/)
  assert.doesNotMatch(script, /text: text\(node\)/)
  assert.match(script, /truncated: true/)
})

test('staged values are JSON-encoded so quotes in a title cannot break out', () => {
  const script = titleEditorScript(BASE, 'a"b\\c\nd')
  assert.match(script, /const value = "a\\"b\\\\c\\nd"/)
})
