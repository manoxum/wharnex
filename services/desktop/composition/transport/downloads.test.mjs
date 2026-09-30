import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readPromptTransportSource } from './prompt-source.mjs'

test('transient protocol ZIPs are deleted promptly and included in storage cleanup', async () => {
  const source = await readPromptTransportSource()
  const browserSession = await readFile(new URL('../../browser/session/session-operations.mjs', import.meta.url), 'utf8')
  const fillStart = source.indexOf('async function fillBundledChatGPTComposer')
  const fillEnd = source.indexOf('\nasync function executeChatGPTDOMScript', fillStart)
  const fill = source.slice(fillStart, fillEnd)
  assert.notEqual(fillStart, -1)
  assert.match(fill, /try \{/)
  assert.match(fill, /finally \{/)
  assert.match(fill, /rm\(path\.dirname\(input\.archivePath\), \{ recursive: true, force: true \}\)/)

  const storageStart = browserSession.indexOf('async function storageUsage()')
  const storageEnd = browserSession.indexOf('\n  async function clearDesktopData', storageStart)
  const storage = browserSession.slice(storageStart, storageEnd)
  assert.match(storage, /TEMP_DATA_NAMES\.includes\(entry\.name\)/)

  const clearStart = browserSession.indexOf('async function clearDesktopData()')
  const clearEnd = browserSession.indexOf('\n  return { exportSession', clearStart)
  assert.match(browserSession.slice(clearStart, clearEnd), /TEMP_DATA_NAMES/)
  assert.match(browserSession, /'wharness-chat-protocol'/)

  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../lifecycle/startup/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /app\.whenReady\(\)\.then\(\(\) => startDesktopRuntime\(createDesktopStartupContext\(\{/)
  assert.match(runtime, /rm\(path\.join\(app\.getPath\('temp'\), 'wharness-chat-protocol'\), \{ recursive: true, force: true \}\)/)
  assert.ok(runtime.indexOf("'wharness-chat-protocol'") < runtime.indexOf('await configureChatGPTSession(chatGPTSessionOptions)'))
})

test('an expired ChatGPT artifact is re-requested instead of clicked forever', async () => {
  const source = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const health = await readFile(new URL('../../chatgpt/session/health/http-status.mjs', import.meta.url), 'utf8')
  // Measured live: 134 clicks against two dead file cards in one lease. The
  // card stays rendered after ChatGPT collects the artifact behind it, so the
  // 404 on its own download endpoint is the only evidence the file is gone.
  assert.match(source, /createChatGPTHTTPHealth\(\{/)
  const detector = health.slice(health.indexOf('function chatGPTInterpreterDownloadConversation('), health.indexOf('\n  function noteChatGPTExpiredArtifact('))
  assert.match(detector, /backend-api\\\/conversation\\\/\(\[A-Za-z0-9-\]\{1,128\}\)\\\/interpreter\\\/download/)

  const httpStatus = health.slice(health.indexOf('function noteChatGPTHTTPStatus('))
  assert.match(httpStatus, /status === 404/)
  assert.match(httpStatus, /noteChatGPTExpiredArtifact\(expiredConversation\)/)

  const worker = await readFile(new URL('../../agent/orchestration/plan/observation.mjs', import.meta.url), 'utf8')
  assert.match(worker, /chatGPTArtifactExpiredSince\(chatAgentConversationID\(flow\.conversationUrl\), flow\.lastRequestedAt\)/)
  // Bounded, and it must not restart the planning work it already did.
  assert.match(source, /maxBundleContinuations: MAX_BUNDLE_CONTINUATIONS/)
  assert.match(worker, /rerequests >= maxBundleContinuations/)
  // Once the artifacts are collected the conversation can never deliver again,
  // so exhaustion clears the checkpoint and the next attempt starts fresh
  // instead of resuming the same dead conversation until the budget runs out.
  assert.match(worker, /conversation_url: '', expected_filename: '', assistant_baseline: 0/)
  assert.match(worker, /writeOrchestratorRequestBundle\(requestPath, \{/)
  assert.match(worker, /redelivery: true/)
  assert.match(worker, /pasteChatGPTFile\(target\.entry, requestPath, 1, 1/)
})

// Every recognizer in the will-download handler may decline, and the handler
// used to end that path with a bare `return`. On the automation partition that
// handed the download to Chromium's default behaviour: a Worker artifact whose
// name did not match landed silently in the operator's Downloads folder
// instead of being captured, and a colliding name raised the operating
// system's own modal Save As dialog, which froze the desktop until dismissed.
// The only surface that keeps ordinary download behaviour is the human
// browsing window, which shares this partition.
test('an unrecognized download on the ChatGPT automation partition fails closed', async () => {
  const source = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const legacy = await readFile(new URL('../../chatgpt/downloads/legacy-plan.mjs', import.meta.url), 'utf8')
  const router = await readFile(new URL('../../chatgpt/downloads/registration/router.mjs', import.meta.url), 'utf8')
  const browsing = await readFile(new URL('../../chatgpt/downloads/registration/source.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatGPTDownloadRouter\(\{/)
  const start = router.indexOf("chatSession.on('will-download'")
  assert.notEqual(start, -1)
  const handler = router.slice(start, router.indexOf('\n    })', start))
  assert.match(handler, /handleLegacyPlanDownload\(item, sourceFilename, sourceWebContents, sourceCacheKey\)/)
  const download = legacy.slice(legacy.indexOf('return function handleLegacyPlanDownload('))

  assert.match(download, /if \(humanBrowsing\(sourceWebContents\)\) return/)
  // The exemption must be reached only after every recognizer declined, and
  // the cancel must follow it - never the other way round.
  const exemption = download.indexOf('humanBrowsing(sourceWebContents)')
  const cancel = download.indexOf('item.cancel()', exemption)
  assert.ok(cancel > exemption, 'the human-browsing exemption must precede the cancel')
  assert.match(download.slice(exemption, cancel + 400), /\[chatgpt-download\] unrecognized artifact cancelled/)

  // An invalid plan name is already reported and cancelled; it must not fall
  // through into the generic cancel and be reported twice.
  assert.match(download, /publishError\('Nome do ficheiro de plano inválido[^)]*\)\n\s*return\n/)

  const helperStart = browsing.indexOf('function chatGPTDownloadIsHumanBrowsing(sourceWebContents)')
  assert.notEqual(helperStart, -1)
  const helper = browsing.slice(helperStart, browsing.indexOf('\n  }', helperStart))
  assert.match(helper, /internalChatGPTBrowsers\.values\(\)/)
  assert.match(helper, /sourceWebContents === wc \|\| sourceWebContents\.hostWebContents === wc/)
})
