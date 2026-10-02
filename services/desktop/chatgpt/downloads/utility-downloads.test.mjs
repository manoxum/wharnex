import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTUtilityDownloads } from './utility-downloads.mjs'

test('utility downloads contain browser duplicate-name suffixes', () => {
  const downloads = createChatGPTUtilityDownloads({
    expectedChatGPTTranslations: new Map(), expectedChatGPTTodoClassifications: new Map(), expectedChatGPTUITestDiscoveries: new Map(),
    tempPath: () => '/tmp',
    MARKDOWN_TRANSLATION_TIMEOUT_MS: 60_000, MAX_MARKDOWN_TRANSLATION_RESULT_BYTES: 8 * 1024 * 1024,
    TODO_CLASSIFICATION_TIMEOUT_MS: 60_000, MAX_TODO_CLASSIFICATION_BYTES: 256 * 1024,
    UI_TEST_DISCOVERY_TIMEOUT_MS: 60_000, MAX_UI_TEST_DISCOVERY_BYTES: 2 * 1024 * 1024,
  })
  const id = 'a'.repeat(20)
  for (const [recognize, filename] of [
    [downloads.registerChatGPTMarkdownTranslationDownload, `whx_translation_res_cat_${id}.zip`],
    [downloads.registerChatGPTTodoClassificationDownload, `whx_todo_classification_res_cat_${id}.zip`],
    [downloads.registerChatGPTUITestDiscoveryDownload, `whx_ui_test_discovery_res_cat_${id}.zip`],
  ]) {
    let cancelled = 0
    const item = { cancel: () => { cancelled += 1 } }
    assert.equal(recognize(item, filename.replace('.zip', ' (2).zip')), true)
    assert.equal(cancelled, 1)
    assert.equal(recognize(item, filename.replace('.zip', ' (10000).zip')), false)
    assert.equal(cancelled, 1)
  }
})
