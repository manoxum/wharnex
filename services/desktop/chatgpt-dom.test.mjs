import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTAssistantTurnCountScript, chatGPTComposerReadyScript, chatGPTResponseCompletionScript, chatGPTExpectedDownloadScript, chatGPTFillComposerScript, chatGPTFocusComposerScript, chatGPTHumanActionScript, chatGPTSubmitScript, chatGPTVisibleActivityScript, chooseChatGPTDownloadCandidate, chooseUsableChatGPTDOMCandidate } from './chatgpt-dom.mjs'

test('DOM automation scripts stay narrow and escape user text', () => {
  const fill = chatGPTFillComposerScript('hello ` ${world} </script>')
  assert.match(fill, /#prompt-textarea/)
  assert.match(fill, /InputEvent/)
  assert.doesNotMatch(fill, /document\.cookie|localStorage|sessionStorage/)
  assert.match(fill, /hello ` \$\{world\}/)
  assert.match(chatGPTFocusComposerScript(), /role=\\"textbox\\"|role="textbox"/)
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
  assert.doesNotMatch(activity, /innerText|textContent|aria-label|document\.cookie|localStorage|sessionStorage|fetch\(/)
})

test('every generated ChatGPT DOM bridge is valid JavaScript before renderer injection', () => {
  const scripts = [
    chatGPTFocusComposerScript(),
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

test('focus, fill, readiness, health, completion and submit share the usable composer selector', () => {
  for (const script of [chatGPTFocusComposerScript(), chatGPTFillComposerScript('prompt'), chatGPTComposerReadyScript(), chatGPTHumanActionScript(), chatGPTResponseCompletionScript(0), chatGPTSubmitScript()]) {
    assert.match(script, /chooseUsableChatGPTDOMCandidate/)
    assert.match(script, /querySelectorAll/)
    assert.doesNotMatch(script, /querySelector\(s\)\)\.find\(Boolean\)/)
  }
  assert.match(chatGPTFocusComposerScript(), /document\.activeElement === composer/)
  assert.match(chatGPTFillComposerScript('prompt'), /document\.activeElement !== composer/)
})

test('download DOM automation is bound to expected canonical filename and narrow latest-turn fallback', () => {
  const script = chatGPTExpectedDownloadScript('wharness-bundle-req_12345678.zip', 3)
  assert.match(script, /wharness-bundle-req_12345678\.zip/)
  assert.match(script, /download\|baixar\|descarregar/)
  assert.match(script, /data-message-author-role=\"assistant\"/)
  assert.match(script, /latest-assistant-unique/)
  assert.match(script, /const baseline = 3/)
  assert.match(script, /assistantTurns\.length > baseline/)
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
