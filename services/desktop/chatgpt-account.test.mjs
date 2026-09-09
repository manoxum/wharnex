import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chatGPTCommitConversationTitleScript,
  chatGPTConversationTitleScript,
  chatGPTHideSidebarScript,
  chatGPTMenuItemRectScript,
  chatGPTNewProjectDialogScript,
  chatGPTOpenConversationMenuScript,
  chatGPTProjectInventoryScript,
  chatGPTProjectItemRectScript,
  chatGPTRenameEditorScript,
  chatGPTShowSidebarScript,
  chatGPTStopConversationScript,
  normalizeChatGPTProjectName,
  normalizeWHXTitle,
  sameChatGPTProjectName,
} from './chatgpt-account.mjs'

const ALL_SCRIPTS = [
  chatGPTHideSidebarScript(),
  chatGPTShowSidebarScript(),
  chatGPTStopConversationScript(),
  chatGPTOpenConversationMenuScript('6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f'),
  chatGPTMenuItemRectScript('rename'),
  chatGPTMenuItemRectScript('archive'),
  chatGPTMenuItemRectScript('move-project'),
  chatGPTMenuItemRectScript('new-project'),
  chatGPTProjectInventoryScript(),
  chatGPTProjectItemRectScript('Wharnex'),
  chatGPTRenameEditorScript(),
  chatGPTCommitConversationTitleScript('fila'),
  chatGPTConversationTitleScript('6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f'),
  chatGPTNewProjectDialogScript('Wharnex'),
]

test('normalizes bounded WHX titles and project names', () => {
  assert.equal(normalizeWHXTitle('  WHX:   Corrigir   fila  '), 'WHX: Corrigir fila')
  assert.equal(normalizeChatGPTProjectName(''), 'Wharnex')
  assert.equal(normalizeWHXTitle('x'.repeat(100)).length, 85)
})

// Remote project duplication (a second "Wharnex" beside an existing "wharnex")
// is prevented by folding case and whitespace before the existence decision.
test('project identity folds case and whitespace so an existing project is never duplicated', () => {
  assert.ok(sameChatGPTProjectName('wharnex', 'Wharnex'))
  assert.ok(sameChatGPTProjectName('  My   Project ', 'my project'))
  assert.ok(!sameChatGPTProjectName('wharnex', 'wharnex-2'))
})

test('account scripts remain typed and avoid assistant response selectors', () => {
  for (const script of ALL_SCRIPTS) {
    assert.doesNotMatch(script, /data-message-author-role/)
    assert.doesNotMatch(script, /localStorage|cookie/)
    assert.doesNotMatch(script, /\.markdown|prose/)
  }
})

test('stop action confirms idle only from a usable composer and otherwise stays ambiguous', () => {
  const script = chatGPTStopConversationScript()
  assert.match(script, /querySelectorAll/)
  assert.match(script, /state: 'stopping'/)
  assert.match(script, /composers\.some\(usable\) \? \{ ok: true, state: 'idle' \} : \{ ok: false, state: 'surface-unavailable' \}/)
  assert.match(script, /aria-disabled/)
  assert.match(script, /visibility/)
})

// The conversation menu must be addressed by the conversation's own id: a
// sidebar reorder between locating and clicking would otherwise open the menu
// of a neighbouring conversation.
test('conversation menu binds to its own conversation id before falling back to the thread header', () => {
  const script = chatGPTOpenConversationMenuScript('6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f')
  assert.match(script, /data-conversation-options-trigger/)
  assert.match(script, /conversation-options-button/)
  assert.match(script, /boundToConversation/)
  assert.doesNotMatch(script, /CSS\.escape/)
})

// Radix menu items ignore synthetic clicks, so these scripts must locate a
// click target for the main process rather than clicking it themselves.
test('menu and project scripts return a click rect instead of clicking', () => {
  for (const script of [chatGPTMenuItemRectScript('rename'), chatGPTMenuItemRectScript('archive'), chatGPTProjectItemRectScript('Wharnex')]) {
    assert.match(script, /rect\(/)
    assert.doesNotMatch(script, /item\.click\(\)/)
  }
})

test('menu item lookup reports the available labels when an action is missing', () => {
  const script = chatGPTMenuItemRectScript('archive')
  assert.match(script, /state: 'action-unavailable'/)
  assert.match(script, /available:/)
  assert.match(script, /arquivar/)
})

// The rename control is an inline sidebar input; the previous implementation
// waited for a dialog ChatGPT never renders.
test('rename targets the inline title editor rather than a dialog', () => {
  for (const script of [chatGPTRenameEditorScript(), chatGPTCommitConversationTitleScript('fila')]) {
    assert.match(script, /input\[name="title-editor"\]/)
    assert.doesNotMatch(script, /role="dialog"/)
  }
  assert.match(chatGPTCommitConversationTitleScript('fila'), /WHX: fila/)
})

test('project inventory reads the account project anchors and reports duplicates', () => {
  assert.match(chatGPTProjectInventoryScript(), /a\[role="menuitem"\]\[href\^="\/g\/g-p-"\]/)
  assert.match(chatGPTProjectItemRectScript('Wharnex'), /duplicates: matches\.length/)
  assert.match(chatGPTProjectItemRectScript('Wharnex'), /toLocaleLowerCase/)
})
