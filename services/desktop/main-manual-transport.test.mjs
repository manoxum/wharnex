import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

function section(startText, endText) {
  const start = source.indexOf(startText)
  assert.notEqual(start, -1, `missing ${startText}`)
  const end = source.indexOf(endText, start)
  assert.notEqual(end, -1, `missing ${endText}`)
  return source.slice(start, end)
}

test('manual mode stops automatic response DOM polling but still captures canonical downloads', () => {
  const bundlePoll = section('async function pollExpectedChatGPTDownloadKey(key)', '\nasync function pollExpectedChatGPTDownloads')
  assert.ok(bundlePoll.indexOf("chatgptTransportModes.get(key) === 'manual'") < bundlePoll.indexOf('EXPECTED_BUNDLE_TTL_MS'))

  const activityPoll = section('async function pollChatGPTVisibleActivity()', '\nasync function performChatGPTRecoveryAction')
  assert.ok(activityPoll.indexOf("chatgptTransportModes.get(key) === 'manual'") < activityPoll.indexOf('executeJavaScript(chatGPTHumanActionScript()'))

  const downloads = section('function registerChatGPTPlanDownloads(chatSession)', '\nfunction chatGPTKeyForEntry')
  assert.doesNotMatch(downloads, /chatgptTransportModes\.get\(sourceCacheKey\) === 'manual'/)
  assert.match(downloads, /canonicalWharnessBundleDownload\(/)
})

test('manual prompt preparation materializes bundles before any composer DOM operation', () => {
  const prepare = section('async function preparePromptForChatGPT(request', '\nasync function queuePreparedPromptForWorker')
  const manualBranch = prepare.indexOf('if (manualTransport) {')
  const targetComposer = prepare.indexOf('targetChatGPTComposer(')
  assert.notEqual(manualBranch, -1)
  assert.ok(manualBranch < targetComposer)
  assert.match(prepare, /manualChatGPTTransport\.prepare\(/)
  assert.match(prepare, /const autoSubmit = !manualTransport && request\?\.autoSubmit === true/)
})

test('manual mode owns picker/copy state and skips the automatic sidebar DOM write', () => {
  const handler = section("ipcMain.handle('wharness:chatgpt:set-transport-mode'", "\n  ipcMain.handle('wharness:chatgpt:start-auth'")
  assert.match(handler, /abortChatGPTTransportPreparations\(key\)/)
  assert.match(handler, /manualChatGPTTransport\.setMode\(/)
  assert.match(handler, /wharness:chatgpt:copy-pending-bundles/)

  const didStop = source.match(/wc\.on\('did-stop-loading',[^\n]+/)?.[0] || ''
  assert.match(didStop, /chatgptTransportModes\.get\(cacheKey\) !== 'manual'/)
})
