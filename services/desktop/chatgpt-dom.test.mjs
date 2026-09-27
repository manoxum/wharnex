import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTAssistantTurnCountScript, chatGPTComposerReadyScript, chatGPTResponseCompletionScript, chatGPTExpectedDownloadScript, chatGPTFillComposerScript, chatGPTHumanActionScript, chatGPTSubmitScript, chatGPTVisibleActivityScript, chatGPTProcessingDurationScript, chatGPTSubmittedRequestEvidenceScript, parseChatGPTProcessingDuration, chooseChatGPTDownloadCandidate, chooseUsableChatGPTDOMCandidate } from './chatgpt-dom.mjs'

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
  assert.match(activity, /data-message-author-role/)
  assert.match(activity, /data-testid\*="reasoning"/)
  assert.match(activity, /data-testid\*="thinking"/)
  assert.match(activity, /group\/activity-header/)
  assert.match(activity, /icon-primary-action path\[d\^="M4\.5 5\.75"\]/)
  assert.match(activity, /rows\.length >= 8/)
  assert.match(activity, /value\.length < 8 \|\| value\.length > 200/)
  assert.match(activity, /node\.textContent/)
  assert.doesNotMatch(activity, /innerText|aria-label|document\.cookie|localStorage|sessionStorage|fetch\(/)
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
    chatGPTSubmittedRequestEvidenceScript('wharness_req_chat-1_req_12345678.zip'),
  ]
  for (const script of scripts) assert.doesNotThrow(() => new Function(script))
})

test('manual resume proves an exact Wharnex archive inside a submitted user turn', () => {
  const expected = 'wharness_req_chat-1_req_12345678.zip'
  const leaf = { children: [], textContent: expected, getAttribute: () => '' }
  const card = { children: [leaf], textContent: expected, getAttribute: () => '', querySelectorAll: () => [leaf] }
  const turn = { querySelectorAll: () => [card] }
  const document = { querySelectorAll: (selector) => selector.includes('group/user-message') ? [turn] : [] }
  const inspect = (filename) => new Function('document', `return ${chatGPTSubmittedRequestEvidenceScript(filename)}`)(document)

  assert.deepEqual(inspect(expected), { submitted: true, userTurn: true, attachment: true, inspectedTurns: 1, inspectedCards: 1 })
  assert.deepEqual(inspect('wharness_req_chat-1_req_other.zip'), { submitted: false, userTurn: true, attachment: false, inspectedTurns: 1, inspectedCards: 1 })
  const script = chatGPTSubmittedRequestEvidenceScript(expected)
  assert.match(script, /data-message-author-role="user"/)
  assert.match(script, /group\/user-message/)
  assert.match(script, /group\/resource-card/)
  assert.doesNotMatch(script, /assistant|innerHTML|document\.cookie|localStorage|sessionStorage|fetch\(/)
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

  // Never a paste: ChatGPT turns long pasted text into an attachment of its
  // own, and the composer then had a spurious pasted-text file to process
  // before it could start uploading the request ZIP - the bundle upload,
  // previously immediate, took a long time to begin.
  assert.doesNotMatch(script, /ClipboardEvent|DataTransfer/)
  // No focus and no selection API - the transport must never touch the remote
  // renderer's focus (AGENTS.md section 8).
  assert.doesNotMatch(script, /\.focus\(|activeElement|createRange|getSelection|execCommand/)

  // Block-structured rather than a flat textContent assignment, so the lines
  // survive instead of collapsing into one run-on line.
  assert.match(script, /split\('\\n'\)/)
  assert.match(script, /createElement\('p'\)/)
  assert.doesNotMatch(script, /composer\.textContent = value/)

  // A missing composer stays the one failure this script reports, as in the
  // long-working version. Verifying the write by reading the composer back
  // added a second way to fail that the working version never had, and it
  // fired on writes that had in fact landed - every caller treats a false as
  // fatal to the request.
  assert.match(script, /if \(!composer\) return false;/)
  assert.doesNotMatch(script, /includes\(wanted\)|holdsWanted/)
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

test('exact generated-file card chooses its download control over its wrapper', () => {
  const filename = 'whx_bundle_res_orchestrator_orp_20260927T144117_72c4527aecd5dbb0.zip'
  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 0, metadata: filename, visible: true, nested: true },
    { index: 1, metadata: `${filename} Transferir`, visible: true, downloadSemantic: true },
    { index: 2, metadata: `${filename} Pré-visualizar`, visible: true },
  ], filename), { index: 1, mode: 'exact' })
  assert.match(chatGPTExpectedDownloadScript(filename, 2), /group\/resource-card/)
})

test('download DOM script finds a completed resource card when assistant count equals the saved baseline', () => {
  const filename = 'whx_bundle_res_orchestrator_orp_20260927T144117_72c4527aecd5dbb0.zip'
  let clicked = ''
  const card = {
    textContent: `${filename} Transferir`, offsetWidth: 120,
    getAttribute: () => null, hasAttribute: () => false,
    closest: () => card, contains: (node) => node === button,
    click: () => { clicked = 'card' },
  }
  const button = {
    textContent: 'Transferir', offsetWidth: 20,
    getAttribute: () => null, hasAttribute: () => false,
    closest: () => card, contains: () => false,
    click: () => { clicked = 'download' },
  }
  const assistant = { contains: (node) => node === card || node === button }
  const document = { querySelectorAll: (selector) => selector === '[data-message-author-role="assistant"]' ? [assistant] : selector === '[data-turn-id]' ? [] : [card, button] }
  const result = new Function('document', `return ${chatGPTExpectedDownloadScript(filename, 1)}`)(document)
  assert.equal(result, 'exact')
  assert.equal(clicked, 'download')
})


test('processing duration parser accepts only allowlisted reasoning disclosure labels', () => {
  const prefixes = ['processou durante', 'thought for']
  assert.equal(parseChatGPTProcessingDuration('Processou durante 5m 23s', prefixes), 323_000)
  assert.equal(parseChatGPTProcessingDuration('Thought for 1h 2m 3s', prefixes), 3_723_000)
  assert.equal(parseChatGPTProcessingDuration('Resposta levou 5m 23s', prefixes), 0)
  assert.equal(parseChatGPTProcessingDuration('Processou durante', prefixes), 0)
  assert.match(chatGPTProcessingDurationScript(prefixes, 2), /button\[aria-expanded\]/)
})
