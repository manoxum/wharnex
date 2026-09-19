import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accountFailureDetail,
  chatGPTCommitConversationTitleScript,
  chatGPTConversationTitleScript,
  chatGPTHideSidebarScript,
  chatGPTLibraryArtifactRectScript,
  chatGPTLibraryArtifactStateScript,
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
  chatGPTLibraryArtifactRectScript('whx_bundle_res_chat-a_req_20260910T201853_b3ac40e93553974d.zip', 'artifact-1'),
  chatGPTLibraryArtifactStateScript('whx_bundle_res_chat-a_req_20260910T201853_b3ac40e93553974d.zip', 'artifact-1'),
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

test('every generated account script is valid JavaScript', () => {
  for (const script of ALL_SCRIPTS) {
    assert.doesNotThrow(() => new Function(`return ${script}`))
  }
})

test('stop action confirms idle only from a usable composer and otherwise stays ambiguous', () => {
  const script = chatGPTStopConversationScript()
  assert.match(script, /querySelectorAll/)
  assert.match(script, /state: 'stopping'/)
  assert.match(script, /rect\(stop\)/)
  assert.doesNotMatch(script, /stop\.click\(\)/)
  assert.match(script, /composers\.some\(usable\) \? \{ ok: true, state: 'idle' \} : \{ ok: false, state: 'surface-unavailable' \}/)
  assert.match(script, /aria-disabled/)
  assert.match(script, /visibility/)
})

// The conversation menu must be addressed by the conversation's own id: a
// sidebar reorder between locating and clicking would otherwise open the menu
// of a neighbouring conversation.
test('conversation menu prefers the exact loaded thread header and otherwise binds to its own history id', () => {
  const script = chatGPTOpenConversationMenuScript('6aa1cb9b-e968-83ea-ab1a-eaaeda5dda4f')
  assert.match(script, /data-conversation-options-trigger/)
  assert.match(script, /conversation-options-button/)
  assert.match(script, /current === id/)
  assert.match(script, /\[exactHeader, owned\]/)
  assert.match(script, /boundToConversation/)
  assert.match(script, /rect\(trigger\)/)
  assert.doesNotMatch(script, /trigger\.click\(\)/)
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

test('all account navigation controls return coordinates for trusted native input', () => {
  for (const script of [chatGPTHideSidebarScript(), chatGPTShowSidebarScript(), chatGPTOpenConversationMenuScript('owned'), chatGPTStopConversationScript()]) {
    assert.match(script, /rect\(/)
    assert.doesNotMatch(script, /\.click\(\)/)
  }
})

test('menu item lookup reports the available labels when an action is missing', () => {
  const script = chatGPTMenuItemRectScript('archive')
  assert.match(script, /state: 'action-unavailable'/)
  assert.match(script, /available:/)
  assert.match(script, /arquivar/)
})

test('stable lifecycle testids do not depend on the role living on the same node', () => {
  const script = chatGPTMenuItemRectScript('delete')
  assert.match(script, /querySelector\('\[data-testid='/)
  assert.match(script, /closest\?\.\('\[role="menuitem"\], button'\)/)
  assert.match(script, /rows: candidates\.length, matches: preferredRaw \? 1 : 0/)
  assert.doesNotMatch(script, /\[role="menuitem"\]\[data-testid=/)
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

test('account value staging never requests DOM focus', () => {
  for (const script of [chatGPTCommitConversationTitleScript('fila'), chatGPTNewProjectDialogScript('Wharnex')]) {
    assert.doesNotMatch(script, /\.focus\(|\.select\(/)
  }
})

test('project inventory reads the account project anchors and reports duplicates', () => {
  assert.match(chatGPTProjectInventoryScript(), /a\[role="menuitem"\]\[href\^="\/g\/g-p-"\]/)
  assert.match(chatGPTProjectItemRectScript('Wharnex'), /duplicates: matches\.length/)
  assert.match(chatGPTProjectItemRectScript('Wharnex'), /toLocaleLowerCase/)
})


test('library cleanup requires exact artifact identity and returns native click coordinates', () => {
  const filename = 'whx_bundle_res_chat-a_req_20260910T201853_b3ac40e93553974d.zip'
  const locate = chatGPTLibraryArtifactRectScript(filename, 'artifact-1')
  const state = chatGPTLibraryArtifactStateScript(filename, 'artifact-1')
  assert.match(locate, /data-page-table-selection-id/)
  assert.match(locate, /Open actions menu for /)
  assert.match(locate, /name === wantedName/)
  assert.match(locate, /id === wantedID/)
  assert.match(locate, /artifact-ambiguous/)
  assert.match(locate, /rect\(/)
  assert.doesNotMatch(locate, /\.includes\(wantedName\)|startsWith\(wantedName\)/)
  assert.match(state, /artifact-absent/)
})

// A bare state string cannot tell "this slot has no layout viewport" apart from
// "this control is genuinely scrolled out of view", which is what let dozens of
// identical ORGANIZE_CHAT failures accumulate carrying nothing actionable.
test('an account failure records the shape of the page, never its text', () => {
  assert.equal(
    accountFailureDetail({ ok: false, state: 'action-offscreen', viewport: { w: 0, h: 0 } }),
    'action-offscreen (viewport=0x0)',
  )
  assert.equal(
    accountFailureDetail({ ok: false, state: 'action-offscreen', viewport: { w: 1280, h: 900 } }),
    'action-offscreen (viewport=1280x900)',
  )

  // The label set missed every item: the count is what says "retrain the
  // labels", and it says so without recording what any control reads.
  const detail = accountFailureDetail({ ok: false, state: 'action-unavailable', available: ['Rename', 'Archive', 'Delete'] })
  assert.equal(detail, 'action-unavailable (items=3)')
  for (const label of ['Rename', 'Archive', 'Delete']) assert.ok(!detail.includes(label))

  assert.equal(accountFailureDetail({ ok: false, state: 'project-missing', count: 7 }), 'project-missing (anchors=7)')
  assert.equal(accountFailureDetail({ ok: false, state: 'menu-unavailable' }), 'menu-unavailable')
  assert.equal(accountFailureDetail(undefined), 'unknown')
})
