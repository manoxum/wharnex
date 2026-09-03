import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTExpectedDownloadScript, chatGPTFillComposerScript, chatGPTFocusComposerScript, chatGPTSubmitScript } from './chatgpt-dom.mjs'

test('DOM automation scripts stay narrow and escape user text', () => {
  const fill = chatGPTFillComposerScript('hello ` ${world} </script>')
  assert.match(fill, /#prompt-textarea/)
  assert.match(fill, /InputEvent/)
  assert.doesNotMatch(fill, /document\.cookie|localStorage|sessionStorage/)
  assert.match(fill, /hello ` \$\{world\}/)
  assert.match(chatGPTFocusComposerScript(), /role=\\"textbox\\"|role="textbox"/)
  assert.match(chatGPTSubmitScript(), /send-button/)
})

test('download DOM automation is bound to expected canonical filename', () => {
  const script = chatGPTExpectedDownloadScript('wharness-bundle-req_12345678.zip')
  assert.match(script, /wharness-bundle-req_12345678\.zip/)
  assert.match(script, /download\|baixar\|descarregar/)
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|document\.cookie/)
})
