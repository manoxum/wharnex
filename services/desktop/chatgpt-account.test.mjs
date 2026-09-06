import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTCommitConversationTitleScript, chatGPTCreateProjectScript, chatGPTFindProjectScript, chatGPTHideSidebarScript, chatGPTShowSidebarScript, chatGPTStopConversationScript, normalizeChatGPTProjectName, normalizeWHXTitle } from './chatgpt-account.mjs'

test('normalizes bounded WHX titles and project names', () => {
  assert.equal(normalizeWHXTitle('  WHX:   Corrigir   fila  '), 'WHX: Corrigir fila')
  assert.equal(normalizeChatGPTProjectName(''), 'Wharnex')
  assert.equal(normalizeWHXTitle('x'.repeat(100)).length, 85)
})

test('account scripts remain typed and avoid assistant response selectors', () => {
  const scripts = [chatGPTHideSidebarScript(), chatGPTShowSidebarScript(), chatGPTStopConversationScript(), chatGPTCommitConversationTitleScript('fila'), chatGPTFindProjectScript('Wharnex'), chatGPTCreateProjectScript('Wharnex')]
  for (const script of scripts) {
    assert.doesNotMatch(script, /data-message-author-role/)
    assert.doesNotMatch(script, /localStorage|cookie/)
  }
})
