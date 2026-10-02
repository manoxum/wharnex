import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'

export function createChatGPTUtilityDownloads({
  expectedChatGPTTranslations, expectedChatGPTTodoClassifications, expectedChatGPTUITestDiscoveries, tempPath,
  MARKDOWN_TRANSLATION_TIMEOUT_MS, MAX_MARKDOWN_TRANSLATION_RESULT_BYTES,
  TODO_CLASSIFICATION_TIMEOUT_MS, MAX_TODO_CLASSIFICATION_BYTES,
  UI_TEST_DISCOVERY_TIMEOUT_MS, MAX_UI_TEST_DISCOVERY_BYTES,
}) {
  // Chromium appends its own browser-side duplicate-name suffix ("(2)") when a
  // name it already has a download for is offered again - exactly what happens
  // when a worker clicks the same result card more than once. The Supervisor's
  // canonicalWharnessBundleDownload already tolerates this (bundlename.mjs's
  // parseBundleNameWithDuplicateSuffix); these background-worker downloads used
  // a strict exact-match instead, so a suffixed repeat fell through every
  // recognizer here and reached the OS as an ordinary, undismissable download
  // prompt.
  function stripChatGPTDownloadDuplicateSuffix(filename) {
    return String(filename || '').replace(/ \([1-9][0-9]{0,3}\)(?=\.[^.]+$)/, '')
  }

  function registerChatGPTMarkdownTranslationDownload(item, sourceFilename) {
    const rawFilename = path.basename(String(sourceFilename || ''))
    const filename = stripChatGPTDownloadDuplicateSuffix(rawFilename)
    const expected = expectedChatGPTTranslations.get(filename)
    const looksInternal = /^whx_translation_res_cat_[a-f0-9]{20}\.zip$/.test(filename)
    if (!expected && !looksInternal) return false
    if (rawFilename !== filename) console.warn(`[translation] normalized duplicate-suffixed download name=${rawFilename} -> ${filename}`)
    if (!expected || Date.now() - expected.armedAt > MARKDOWN_TRANSLATION_TIMEOUT_MS + 60_000) {
      item.cancel()
      return true
    }
    expected.downloadStarted = true
    const total = Number(item.getTotalBytes?.() || 0)
    if (total > MAX_MARKDOWN_TRANSLATION_RESULT_BYTES) {
      item.cancel()
      expected.reject(new Error('Translation bundle exceeds the 8 MiB result limit'))
      return true
    }
    const dir = path.join(tempPath(), 'wharness-markdown-translations', expected.taskId)
    const savePath = path.join(dir, filename)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      item.setSavePath(savePath)
    } catch (error) {
      item.cancel()
      expected.reject(error instanceof Error ? error : new Error(String(error)))
      return true
    }
    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_MARKDOWN_TRANSLATION_RESULT_BYTES) {
        item.cancel()
        expected.reject(new Error('Translation bundle exceeds the 8 MiB result limit'))
      }
    })
    item.once('done', async (_doneEvent, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') expected.reject(new Error(`Translation bundle download ended in state ${state}`))
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > MAX_MARKDOWN_TRANSLATION_RESULT_BYTES) throw new Error('Translation bundle exceeds the 8 MiB result limit')
        // The bytes travel to the backend unopened. The Desktop bounds their
        // size and nothing else: parsing the archive here would put the protocol
        // in two places, and the half that validates the answer is the half that
        // wrote the request.
        expected.resolve(bytes)
      } catch (error) {
        expected.reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        await rm(savePath, { force: true }).catch(() => undefined)
      }
    })
    return true
  }

  function registerChatGPTTodoClassificationDownload(item, sourceFilename) {
    const rawFilename = path.basename(String(sourceFilename || ''))
    const filename = stripChatGPTDownloadDuplicateSuffix(rawFilename)
    const expected = expectedChatGPTTodoClassifications.get(filename)
    const looksInternal = /^whx_todo_classification_res_cat_[a-f0-9]{20}\.zip$/.test(filename)
    if (!expected && !looksInternal) return false
    if (rawFilename !== filename) console.warn(`[todo-classification] normalized duplicate-suffixed download name=${rawFilename} -> ${filename}`)
    if (!expected || Date.now() - expected.armedAt > TODO_CLASSIFICATION_TIMEOUT_MS + 60_000) {
      item.cancel()
      return true
    }
    if (Number(item.getTotalBytes?.() || 0) > MAX_TODO_CLASSIFICATION_BYTES) {
      item.cancel(); expected.reject(new Error('TODO classification bundle exceeds the transport limit')); return true
    }
    const dir = path.join(tempPath(), 'wharnex-todo-classifications', expected.taskId)
    const savePath = path.join(dir, filename)
    try { mkdirSync(dir, { recursive: true, mode: 0o700 }); item.setSavePath(savePath) }
    catch (error) { item.cancel(); expected.reject(error instanceof Error ? error : new Error(String(error))); return true }
    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_TODO_CLASSIFICATION_BYTES) {
        item.cancel(); expected.reject(new Error('TODO classification bundle exceeds the transport limit'))
      }
    })
    item.once('done', async (_event, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') expected.reject(new Error(`TODO classification download ended in state ${state}`))
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > MAX_TODO_CLASSIFICATION_BYTES) throw new Error('TODO classification bundle exceeds the transport limit')
        expected.resolve(bytes)
      } catch (error) { expected.reject(error instanceof Error ? error : new Error(String(error))) }
      finally { await rm(savePath, { force: true }).catch(() => undefined) }
    })
    return true
  }


  function registerChatGPTUITestDiscoveryDownload(item, sourceFilename) {
    const rawFilename = path.basename(String(sourceFilename || ''))
    const filename = stripChatGPTDownloadDuplicateSuffix(rawFilename)
    const expected = expectedChatGPTUITestDiscoveries.get(filename)
    const looksInternal = /^whx_ui_test_discovery_res_cat_[a-f0-9]{20}\.zip$/.test(filename)
    if (!expected && !looksInternal) return false
    if (rawFilename !== filename) console.warn(`[ui-test-discovery] normalized duplicate-suffixed download name=${rawFilename} -> ${filename}`)
    if (!expected || Date.now() - expected.armedAt > UI_TEST_DISCOVERY_TIMEOUT_MS + 60_000) {
      item.cancel()
      return true
    }
    expected.downloadStarted = true
    if (Number(item.getTotalBytes?.() || 0) > MAX_UI_TEST_DISCOVERY_BYTES) {
      item.cancel(); expected.reject(new Error('UI test discovery bundle exceeds the transport limit')); return true
    }
    const dir = path.join(tempPath(), 'wharnex-ui-testing', expected.taskId)
    const savePath = path.join(dir, filename)
    try { mkdirSync(dir, { recursive: true, mode: 0o700 }); item.setSavePath(savePath) }
    catch (error) { item.cancel(); expected.reject(error instanceof Error ? error : new Error(String(error))); return true }
    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_UI_TEST_DISCOVERY_BYTES) {
        item.cancel(); expected.reject(new Error('UI test discovery bundle exceeds the transport limit'))
      }
    })
    item.once('done', async (_event, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') expected.reject(new Error(`UI test discovery download ended in state ${state}`))
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > MAX_UI_TEST_DISCOVERY_BYTES) throw new Error('UI test discovery bundle exceeds the transport limit')
        expected.resolve(bytes)
      } catch (error) { expected.reject(error instanceof Error ? error : new Error(String(error))) }
      finally { await rm(savePath, { force: true }).catch(() => undefined) }
    })
    return true
  }

  return { registerChatGPTMarkdownTranslationDownload, registerChatGPTTodoClassificationDownload, registerChatGPTUITestDiscoveryDownload }
}
