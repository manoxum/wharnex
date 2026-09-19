import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTAssistantTurnCountScript, chatGPTComposerReadyScript, chatGPTResponseCompletionScript, chatGPTExpectedDownloadScript, chatGPTFillComposerScript, chatGPTHumanActionScript, chatGPTSubmitScript, chatGPTVisibleActivityScript, chatGPTProcessingDurationScript, parseChatGPTProcessingDuration, chooseChatGPTDownloadCandidate, chooseUsableChatGPTDOMCandidate } from './chatgpt-dom.mjs'

test('DOM automation scripts stay narrow and escape user text', () => {
  const fill = chatGPTFillComposerScript('hello ` ${world} </script>')
  assert.match(fill, /#prompt-textarea/)
  assert.match(fill, /InputEvent/)
  assert.doesNotMatch(fill, /document\.cookie|localStorage|sessionStorage/)
  assert.match(fill, /hello ` \$\{world\}/)
  assert.match(chatGPTComposerReadyScript(), /role=\\"textbox\\"|role="textbox"/)
  assert.match(chatGPTSubmitScript(), /send-button/)
  assert.match(chatGPTComposerReadyScript(), /aria-disabled/)
  assert.doesNotMatch(chatGPTComposerReadyScript(), /stop-button/)
  const completion = chatGPTResponseCompletionScript(4)
  assert.match(completion, /assistantCount > baseline/)
  assert.match(completion, /composerReady/)
  const gate = chatGPTHumanActionScript()
  assert.match(gate, /challenges\.cloudflare\.com/)
  assert.match(gate, /cf-turnstile-response/)
  assert.match(gate, /arkoselabs|funcaptcha/)
  assert.match(gate, /hcaptcha|recaptcha/)
  assert.match(gate, /visibilityState/)
  assert.doesNotMatch(gate, /innerText|textContent|document\.cookie|localStorage|sessionStorage|fetch\(/)
  const activity = chatGPTVisibleActivityScript()
  assert.match(activity, /data-testid="stop-button"/)
  assert.match(activity, /thinking/)
  assert.match(activity, /data-message-author-role="assistant"/)
  assert.match(activity, /rows\.length >= 8/)
  assert.match(activity, /value\.length < 8 \|\| value\.length > 200/)
  assert.match(activity, /node\.textContent/)
  assert.doesNotMatch(activity, /innerText|aria-label|document\.cookie|localStorage|sessionStorage|fetch\(/)
})

// Visible-reasoning capture is the one place a DOM script may read generated
// text, as a deliberate and bounded exception (AGENTS.md section 8, ADR-0038).
// These assertions are the boundary of that exception: it reads the reasoning
// steps ChatGPT is showing, and nothing else.
test('visible reasoning capture stays inside its exception', () => {
  const activity = chatGPTVisibleActivityScript()

  // The answer itself, code and tool output are excluded structurally, by
  // container — never by judging what the text says.
  for (const selector of ['pre', 'code', '.markdown', '.sr-only', '[data-message-author-role]']) {
    assert.ok(activity.includes(`'${selector}'`), `missing structural exclusion ${selector}`)
  }
  assert.match(activity, /node\.children\.length/)

  // Bounded: a probe runs on every supervised chat on every tick.
  assert.match(activity, /rows\.length >= 8/)
  assert.match(activity, /value\.length < 8 \|\| value\.length > 200/)

  // A wrapper repeats the concatenation of the rows beneath it.
  assert.match(activity, /rows\.filter\(\(row\) => !rows\.some/)

  // Passive: a health probe observes, it never mutates the page. Expanding a
  // collapsed reasoning disclosure would be a click.
  assert.doesNotMatch(activity, /\.click\(\)/)

  // Liveness must survive a failure to read reasoning.
  assert.match(activity, /catch \{ \/\* reasoning is optional; liveness is not \*\/ \}/)
})

test('every generated ChatGPT DOM bridge is valid JavaScript before renderer injection', () => {
  const scripts = [
    chatGPTFillComposerScript('prompt'),
    chatGPTSubmitScript(),
    chatGPTAssistantTurnCountScript(),
    chatGPTComposerReadyScript(),
    chatGPTHumanActionScript(),
    chatGPTResponseCompletionScript(2),
    chatGPTExpectedDownloadScript('wharness-bundle-req_12345678.zip', 1),
    chatGPTVisibleActivityScript(),
  ]
  for (const script of scripts) assert.doesNotThrow(() => new Function(script))
})

test('composer selection ignores stale disabled and hidden candidates', () => {
  const disabled = { disabled: true, getAttribute: () => null }
  const ariaDisabled = { disabled: false, getAttribute: (name) => name === 'aria-disabled' ? 'true' : null }
  const hidden = { disabled: false, hidden: true, getAttribute: () => null }
  const cssHidden = { disabled: false, getAttribute: () => null }
  const usable = { disabled: false, getAttribute: () => null }
  const styleFor = (node) => ({ display: node === cssHidden ? 'none' : 'block', visibility: 'visible' })

  assert.equal(chooseUsableChatGPTDOMCandidate([disabled, ariaDisabled, hidden, cssHidden, usable], styleFor), usable)
  assert.equal(chooseUsableChatGPTDOMCandidate([disabled, hidden], styleFor), undefined)
})

test('composer probes and mutations never request renderer focus', () => {
  for (const script of [chatGPTFillComposerScript('prompt'), chatGPTComposerReadyScript(), chatGPTHumanActionScript(), chatGPTResponseCompletionScript(0), chatGPTSubmitScript()]) {
    assert.match(script, /chooseUsableChatGPTDOMCandidate/)
    assert.match(script, /querySelectorAll/)
    assert.doesNotMatch(script, /querySelector\(s\)\)\.find\(Boolean\)/)
  }
  assert.match(chatGPTComposerReadyScript(), /Boolean\(composer\)/)
  assert.doesNotMatch(chatGPTComposerReadyScript(), /\.focus\(|activeElement/)
  assert.doesNotMatch(chatGPTFillComposerScript('prompt'), /\.focus\(|activeElement|createRange|getSelection/)
})

// Two live symptoms, one cause: assigning textContent wrote around the rich
// editor's own document model, so the editor re-rendered from its still-empty
// state when the attachment landed and the request reached ChatGPT as a bare
// ZIP with no prompt at all - and whatever did survive arrived as one run-on
// line, because textContent carries no block structure and every newline
// collapsed to a space.
test('composer text is written through the editor model and keeps its line structure', () => {
  const script = chatGPTFillComposerScript('WHARNEX INPUT req_1\nChatId: abc\nRead the ZIP.')

  // Offered as a paste first: a rich editor handles paste through its own
  // model, which is what survives the attachment re-render.
  assert.match(script, /new ClipboardEvent\('paste'/)
  assert.match(script, /setData\('text\/plain', value\)/)
  // Still no focus and no selection API - the transport must never touch the
  // remote renderer's focus (AGENTS.md section 8).
  assert.doesNotMatch(script, /\.focus\(|activeElement|createRange|getSelection|execCommand/)

  // The direct-write fallback is block-structured rather than a flat
  // textContent assignment, so the lines survive there too.
  assert.match(script, /split\('\\n'\)/)
  assert.match(script, /createElement\('p'\)/)
  assert.doesNotMatch(script, /composer\.textContent = value/)

  // Confirmed by reading the composer back, never from the paste event's own
  // return value: cancelling a paste says the page handled the event, not that
  // the text landed - and an exact-match check failed a fill that had landed,
  // because the editor adds structure of its own.
  assert.match(script, /const holdsWanted = \(\) => normalize\(composer\.textContent\)\.includes\(wanted\)/)
  assert.match(script, /if \(!holdsWanted\(\)\)/)
  assert.match(script, /return holdsWanted\(\)/)
})

test('download DOM automation is bound to expected canonical filename and narrow latest-turn fallback', () => {
  const script = chatGPTExpectedDownloadScript('wharness-bundle-req_12345678.zip', 3)
  assert.match(script, /wharness-bundle-req_12345678\.zip/)
  // European Portuguese ChatGPT accounts label the control "Transferir"
  // (Brazilian accounts use "Baixar"); the control was visible and unclicked
  // every time until this term was added.
  assert.match(script, /download\|baixar\|descarregar\|transferir/)
  assert.match(script, /data-message-author-role=\"assistant\"/)
  assert.match(script, /latest-assistant-unique/)
  assert.match(script, /const baseline = 3/)
  assert.match(script, /assistantTurns\.length > baseline/)
  assert.match(script, /\[data-turn-id\]/)
  assert.match(script, /data-testid\*="file"/)
  assert.match(script, /nearbyText/)
  assert.match(script, /data-testid\*=.*download/)
  assert.match(chatGPTAssistantTurnCountScript(), /data-message-author-role/)
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|document\.cookie|localStorage|sessionStorage/)
})

test('download candidate policy prefers exact filename and only accepts one newest assistant fallback', () => {
  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 0, metadata: 'download old.zip', latestAssistant: true, downloadSemantic: true, visible: true },
    { index: 1, metadata: 'wharness-bundle-req_12345678.zip', latestAssistant: false, visible: true },
  ], 'wharness-bundle-req_12345678.zip'), { index: 1, mode: 'exact' })

  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 4, metadata: '⬇️', latestAssistant: true, iconOnly: true, visible: true },
  ], 'wharness-bundle-req_12345678.zip'), { index: 4, mode: 'latest-assistant-unique' })

  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 7, metadata: 'generated file', latestTurn: true, fileLike: true, visible: true },
  ], 'wharness-bundle-req_12345678.zip'), { index: 7, mode: 'latest-turn-unique' })

  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 4, metadata: '⬇️', latestAssistant: true, iconOnly: true, visible: true },
    { index: 5, metadata: 'Download', latestAssistant: true, downloadSemantic: true, visible: true },
  ], 'wharness-bundle-req_12345678.zip'), { index: -1, mode: '' })

  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 4, metadata: '⬇️', latestAssistant: false, iconOnly: true, visible: true },
  ], 'wharness-bundle-req_12345678.zip'), { index: -1, mode: '' })

  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 7, metadata: 'Download', latestAssistant: true, downloadSemantic: true, visible: true, nested: true },
    { index: 8, metadata: '⬇️', latestAssistant: true, iconOnly: true, visible: true },
  ], 'wharness-bundle-req_12345678.zip'), { index: 8, mode: 'latest-assistant-unique' })
})


test('processing duration parser accepts only allowlisted reasoning disclosure labels', () => {
  const prefixes = ['processou durante', 'thought for']
  assert.equal(parseChatGPTProcessingDuration('Processou durante 5m 23s', prefixes), 323_000)
  assert.equal(parseChatGPTProcessingDuration('Thought for 1h 2m 3s', prefixes), 3_723_000)
  assert.equal(parseChatGPTProcessingDuration('Resposta levou 5m 23s', prefixes), 0)
  assert.equal(parseChatGPTProcessingDuration('Processou durante', prefixes), 0)
  assert.match(chatGPTProcessingDurationScript(prefixes, 2), /button\[aria-expanded\]/)
})
