import { readPromptTransportSource } from '../transport/prompt-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('legacy title tasks cannot create temporary ChatGPT conversations', async () => {
  const source = await readPromptTransportSource()
  const discoverStart = source.indexOf('async function executeChatAgentTitleDiscover(')
  const discoverEnd = source.indexOf('\nasync function executeChatAgentTempTitle', discoverStart)
  const discover = source.slice(discoverStart, discoverEnd)
  assert.match(discover, /Compatibility sink/)
  assert.doesNotMatch(discover, /suggestChatGPTConversationTitle|TITLE_GENERATE_TEMP|ORGANIZE_CHAT/)

  const tempStart = source.indexOf('async function executeChatAgentTempTitle(')
  const tempEnd = source.indexOf('\nasync function executeChatAgentTitleAwait', tempStart)
  const temp = source.slice(tempStart, tempEnd)
  assert.match(temp, /Compatibility sink/)
  assert.doesNotMatch(temp, /targetChatGPTComposer|submitChatGPTDraft|TITLE_AWAIT/)
})

// Rapidly cycling sandboxed renderers on the shared ChatGPT partition triggers
// Electron's "Cannot destructure property 'preloadScripts' of
// 'binding.startupData'" crash, which takes the trusted frontend renderer down
// with it and reloads the app. Deferred maintenance therefore drives only an
// already-resident surface instead of creating one for itself.
test('deferred remote archive reuses a leased worker and never allocates a new chat surface', async () => {
  const source = await readFile(new URL('../../chatgpt/account/conversation/archive.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function archiveChatGPTConversation(')
  assert.notEqual(start, -1)
  const body = source.slice(start)

  assert.match(body, /const entry = entryOverride \|\| chatgptViews\.get\(key\)/)
  assert.doesNotMatch(body, /ensureChatGPTView\(/)
  assert.match(body, /state: 'view-not-live'/)
  assert.match(body, /entry\.role === 'worker'/)
  assert.match(body, /entry\.ownerKey = ''/)
  assert.doesNotMatch(body, /ok: true, state: 'view-not-live'/)
})

test('an offscreen account control reports the viewport that measured it', async () => {
  const [account, agent, effort, builder] = await Promise.all([
    Promise.all(['prelude', 'sidebar', 'conversation-menu', 'project', 'library'].map((name) =>
      readFile(new URL(`../../chatgpt/account/scripts/${name}.mjs`, import.meta.url), 'utf8'))).then((parts) => parts.join('\n')),
    readFile(new URL('../../agent/automation/chat-agent-scripts.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../agent/automation/chat-agent-reasoning-effort-scripts.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../agent/automation/chat-agent-script-builder.mjs', import.meta.url), 'utf8'),
  ])

  // Without this, "the slot has no layout viewport" and "the control is
  // genuinely scrolled out of view" are the same opaque string in the task's
  // last_error, which is what let the 0x0 fault stay invisible across dozens of
  // identical failures. The viewport is control geometry, never page content.
  for (const source of [account, agent, effort]) {
    for (const [, state] of source.matchAll(/state: '([a-z-]*offscreen)'/g)) {
      const occurrence = new RegExp(`state: '${state}', viewport: viewport\\(\\)`)
      assert.match(source, occurrence, `${state} must report the measuring viewport`)
    }
  }
  // The account scripts keep their own prelude (chatgpt/account/scripts/prelude.mjs);
  // chat-agent-scripts.mjs and the script families built with `script()` share
  // one definition from chat-agent-script-builder.mjs.
  assert.match(account, /const viewport = \(\) => \(\{ w: innerWidth, h: innerHeight \}\)/)
  assert.match(builder, /const viewport = \(\) => \(\{ w: innerWidth, h: innerHeight \}\)/)
})

// The diagnostic is only worth collecting if it survives to the task row. Every
// intermediate return in the organize/ensure-project flow used to rebuild a bare
// { ok, state, project } object, which discarded the viewport and control counts
// the script had just measured — so `accountFailureDetail` saw a bare state and
// the failure stayed as opaque as before.
test('account diagnostics survive the organize flow instead of being rebuilt away', async () => {
  for (const [file, factory] of [
    ['project/ensure.mjs', 'async function ensureChatGPTProject('],
    ['conversation/organize.mjs', 'async function organizeChatGPTConversation('],
  ]) {
    const source = await readFile(new URL(`../../chatgpt/account/${file}`, import.meta.url), 'utf8')
    const start = source.indexOf(factory)
    assert.ok(start > 0, `${factory} must exist`)
    const body = source.slice(start, source.indexOf('\n}', start))
    for (const [, returned] of body.matchAll(/if \(![a-zA-Z]+\.ok\) return (\{[^}]*\})/g)) {
      assert.match(returned, /^\{ \.\.\./, `${returned} drops the measured diagnostic`)
    }
  }
})

test('legacy auxiliary conflict tasks cannot overwrite durable chat affinity', async () => {
  const source = await readPromptTransportSource()
  const helper = source.slice(source.indexOf('function durableWorkspaceChatID('), source.indexOf('\nfunction chatAgentTaskPayload', source.indexOf('function durableWorkspaceChatID(')))
  assert.match(helper, /_cf_/)
  assert.match(helper, /return ''/)

  const prepareSignature = 'async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})'
  const prepare = source.slice(source.indexOf(prepareSignature), source.indexOf('\nasync function retryPersistedChatGPTPrompt', source.indexOf(prepareSignature)))
  assert.match(prepare, /durableWorkspaceChatID\(key, request\?\.workspaceChatId\)/)
  assert.match(prepare, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort/)

  const write = source.slice(source.indexOf('async function executeChatAgentWrite('), source.indexOf('\nasync function enqueueOrganizeFromTitle', source.indexOf('async function executeChatAgentWrite(')))
  assert.match(write, /durableWorkspaceChatID\(key, payload\.workspace_chat_id\)/)
  assert.match(write, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort/)

  const resume = await readFile(new URL('../../chatgpt/transport/downloads/recovery/resume.mjs', import.meta.url), 'utf8')
  assert.match(source, /registerExpectedBundleRecoveryIPC\(\{/)
  assert.match(resume, /durableWorkspaceChatID\(key, request\?\.workspaceChatId\)/)
  assert.match(resume, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort\(workspaceChatId/)
  assert.match(resume, /sessionId: request\?\.sessionId, workspaceChatId/)
})

// harness_chat_agent_tasks showed 124/124 RENAME_CHAT/ARCHIVE_CHAT/
// DELETE_TEMP_CHAT attempts failing with last_error 'menu-not-open' since
// 2026-09-15, every task-level retry (up to 8 attempts) hitting the identical
// outcome: the trigger was clicked exactly once and only the menu-item lookup
// was ever retried, so a menu that failed to render on that single click could
// never be reopened.
test('a conversation menu that fails to render is reopened before the action gives up', async () => {
  const source = await readFile(new URL('../../chatgpt/account/control/actions.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function chooseChatGPTConversationAction(')
  assert.notEqual(start, -1)
  const fn = source.slice(start, source.indexOf('\n}', start) + 2)

  assert.match(fn, /for \(let attempt = 0; attempt < CHATGPT_MENU_REOPEN_ATTEMPTS; attempt \+= 1\)/)
  const loopStart = fn.indexOf('for (')
  const loop = fn.slice(loopStart, fn.indexOf('\n  }', loopStart))
  assert.match(loop, /chatGPTOpenConversationMenuScript\(conversationId\)/)
  assert.match(loop, /if \(!opened\.ok\) return opened/)
  assert.match(loop, /if \(located\.state !== 'menu-not-open'\) return located/)
})

// Account-lifecycle actions (organize/archive/delete/delete-library-artifact)
// only ever shared serializeChatGPTAccountOperation's back-to-back queue,
// never the process-wide navigation gate a submission respects. A live
// DELETE_BUNDLE backlog of over a hundred items reproduced this: each one
// navigated to chatgpt.com/library the instant the previous one finished,
// with no request ever spaced out, severe enough to crash the desktop.
test('every account-lifecycle action paces its navigation like a submission does', async () => {
  for (const [file, open] of [
    ['conversation/organize.mjs', 'async function organizeChatGPTConversation('],
    ['conversation/archive.mjs', 'async function archiveChatGPTConversation('],
    ['conversation/delete.mjs', 'async function deleteChatGPTConversation('],
    ['library/delete.mjs', 'async function deleteChatGPTLibraryArtifact('],
  ]) {
    const source = await readFile(new URL(`../../chatgpt/account/${file}`, import.meta.url), 'utf8')
    const start = source.indexOf(open)
    assert.notEqual(start, -1, open)
    const fn = source.slice(start)
    const activeIndex = fn.indexOf('accountOperationActive = true')
    const paceIndex = fn.indexOf('await paceChatGPTWorkerNavigation()')
    const loadIndex = fn.indexOf('loadOwnedChatGPTURL(')
    assert.notEqual(activeIndex, -1, open)
    assert.notEqual(paceIndex, -1, `${open} must pace its navigation`)
    assert.notEqual(loadIndex, -1, open)
    assert.ok(activeIndex < paceIndex, `${open}: pacing must happen inside the serialized operation`)
    assert.ok(paceIndex < loadIndex, `${open}: pacing must happen before navigating`)
  }
})
