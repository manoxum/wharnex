import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readSchedulerStartupSource } from '../workers/scheduler-startup-source.mjs'
import { readDesktopCompositionSource } from '../entry/source.mjs'

// Measured on Electron 44: a WebContentsView given bounds while already hidden
// reports a 0x0 viewport to its renderer, because Electron delivers a resize
// only while the view is visible. The identical view given the same bounds
// before being hidden reports 1280x900 and keeps it across later navigations.
//
// A chat slot left at 0x0 fails account automation twice over: every located
// control's centre lies outside the viewport, so `rect()` returns null and the
// operation reports `action-offscreen`; and every percentage-width node
// collapses to width 0, so the shared `visible()` predicate rejects it.
test('a chat slot is given its layout viewport before it is ever hidden', async () => {
  const source = await readDesktopCompositionSource()
  const authViewRuntime = await readFile(new URL('../session/auth-view/runtime.mjs', import.meta.url), 'utf8')
  const viewportSource = await readFile(new URL('../../chatgpt/account/control/viewport.mjs', import.meta.url), 'utf8')
  const supervisorSource = await readFile(new URL('../../chatgpt/session/views/supervisor.mjs', import.meta.url), 'utf8')
  const workerSource = await readFile(new URL('../../chatgpt/session/views/worker.mjs', import.meta.url), 'utf8')
  const entrySource = await readFile(new URL('../../chatgpt/session/views/entry.mjs', import.meta.url), 'utf8')
  assert.match(source, /compose\(ctx, 'auth-views', createDesktopAuthViewRuntime, \{/)
  assert.match(authViewRuntime, /createChatGPTViewOperations\(\{/)

  const grantStart = viewportSource.indexOf('function grantChatGPTLayoutViewport(')
  assert.ok(grantStart > 0, 'grantChatGPTLayoutViewport must exist')
  const grant = viewportSource.slice(grantStart, viewportSource.indexOf('\n  }', grantStart))
  // visible -> resize -> hidden, in that order. No compositor frame is produced
  // between the two setVisible calls, so the view never appears on screen -
  // which only holds while the sequence stays synchronous.
  assert.match(grant, /setVisible\(true\)[\s\S]*setBounds\([\s\S]*setVisible\(false\)/)
  assert.doesNotMatch(grant, /await/)

  const supervisorStart = supervisorSource.indexOf('function createChatGPTView(')
  const supervisor = supervisorSource.slice(supervisorStart, supervisorSource.indexOf('\n    const wc = view.webContents', supervisorStart))
  assert.doesNotMatch(supervisor, /view\.setVisible\(false\)/)
  // The real view is created in the browser host, never in a project window.
  assert.doesNotMatch(supervisor, /addChildView/)
  assert.match(supervisor, /createHostedChatGPTSurface\(native, \{ View: browserHost\.View, host: browserHost \}\)/)
  assert.match(supervisor, /grantChatGPTLayoutViewport\(view\)/)
  assert.match(supervisor, /createChatGPTViewEntry\(view, cacheKey, windowState\.id/)

  const workerStart = workerSource.indexOf('function createChatGPTWorkerView(')
  const worker = workerSource.slice(workerStart, workerSource.indexOf('\n    const wc = view.webContents', workerStart))
  assert.doesNotMatch(worker, /view\.setVisible\(false\)/)
  assert.doesNotMatch(worker, /addChildView/)
  assert.match(worker, /createHostedChatGPTSurface\(native, \{ View: browserHost\.View, host: browserHost \}\)/)
  assert.match(worker, /grantChatGPTLayoutViewport\(view\)/)
  assert.match(worker, /createChatGPTViewEntry\(view, '', windowState\.id/)
  assert.match(entrySource, /layoutViewportGranted: true/)
})

test('background native input preserves the already-focused local composer', async () => {
  const [viewportSource, actionsSource, inputSource, guard] = await Promise.all([
    readFile(new URL('../../chatgpt/account/control/viewport.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../chatgpt/account/control/actions.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../chatgpt/account/control/input.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../window/lifecycle/local-focus-guard.mjs', import.meta.url), 'utf8'),
  ])
  const helperStart = viewportSource.indexOf('function focusedLocalWharnexContents()')
  const helper = viewportSource.slice(helperStart, viewportSource.indexOf('\n  function ensureChatGPTLayoutViewport(', helperStart))
  assert.ok(helperStart > 0)
  assert.match(helper, /BrowserWindow\.getFocusedWindow\(\)/)
  assert.match(helper, /contents\.isFocused\(\)/)
  assert.match(helper, /preserveLocalFocusDuringBackgroundOperation/)
  assert.match(helper, /BrowserWindow\.fromWebContents\(contents\)/)
  assert.doesNotMatch(helper, /view\.webContents\.focus\(|wc\.focus\(/)
  assert.match(guard, /BACKGROUND_NATIVE_FOCUS_RESTORE_DELAYS_MS = \[0, 16, 48\]/)
  assert.match(guard, /isOwnerFocused\?\.\(owner\)/)

  const accountStart = actionsSource.indexOf('async function commitChatGPTAccountControl(')
  const account = actionsSource.slice(accountStart, actionsSource.indexOf('\n  async function chooseChatGPTConversationAction', accountStart))
  // Held press: these conversation menus are Radix triggers that settle back
  // closed when pointerdown and pointerup land in the same tick, which is the
  // `menu-not-open` that dominates this queue's failures.
  assert.match(account, /pressChatGPTControl\(entry, wc, located\.rect\)/)

  const router = inputSource.slice(inputSource.indexOf('async function pressChatGPTControl('))
  assert.match(router.slice(0, 900), /dispatchChatGPTPointerPress\(wc, rect, \{ wait, guard: withPreservedLocalFocus \}\)/)
  const press = await readFile(new URL('../../chatgpt/transport/requests/chatgpt-input.mjs', import.meta.url), 'utf8')
  const pressBody = press.slice(press.indexOf('export async function dispatchChatGPTPointerPress('))
  assert.match(pressBody.slice(0, 1200), /guard\(\(\) => \{[\s\S]*mouseDown[\s\S]*\}\)\n\s*await wait\(/)
  assert.match(pressBody.slice(0, 1200), /await wait\([\s\S]*guard\(\(\) => webContents\.sendInputEvent\(\{ type: 'mouseUp'/)
  // The visibility-aware key router keeps the focus guard on the native path.
  const keyRouter = inputSource.slice(inputSource.indexOf('async function pressChatGPTControlKey('))
  assert.match(keyRouter.slice(0, 900), /withPreservedLocalFocus\(\(\) => dispatchChatGPTAccountKey\(wc, name\)\)/)
})

test('the layout viewport guard does not read native bounds as renderer evidence', async () => {
  const [source, viewportSource] = await Promise.all([
    readFile(new URL('../../chatgpt/session/views/cleanup.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../chatgpt/account/control/viewport.mjs', import.meta.url), 'utf8'),
  ])
  const start = viewportSource.indexOf('function ensureChatGPTLayoutViewport(')
  const viewport = viewportSource.slice(start, viewportSource.indexOf('\n  }', viewportSource.indexOf('return true', start)))

  // getBounds() reports the bounds that were *set*, not the viewport the page
  // actually has. The first ineffective setBounds therefore made this guard
  // report 1280x900 forever after, so no later call could repair the slot -
  // which is why every ORGANIZE_CHAT attempt failed identically until the task
  // exhausted its budget.
  assert.doesNotMatch(viewport, /entry\.view\.getBounds/)
  assert.match(viewport, /entry\.layoutViewportGranted === true\) return false/)
  assert.match(viewport, /grantChatGPTLayoutViewport\(entry\.view\)/)

  // Re-homing moves ownership only; the real view is never re-parented.
  const rehomeStart = source.indexOf('function rehomeChatGPTWorkers(')
  const rehome = source.slice(rehomeStart, source.indexOf('\n  }', rehomeStart))
  assert.doesNotMatch(rehome, /addChildView|removeChildView/)
})

test('startup restores every saved window session without asking', async () => {
  const main = await readDesktopCompositionSource()
  const wiring = await readFile(new URL('../startup/runtime.mjs', import.meta.url), 'utf8')
  const context = await readFile(new URL('../../lifecycle/startup/context.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../lifecycle/startup/runtime.mjs', import.meta.url), 'utf8')
  const restore = await readFile(new URL('../../window/lifecycle/startup/restore.mjs', import.meta.url), 'utf8')
  // A session waiting for a click stalled every Worker claim while nobody was
  // at the machine; restoring is the default.
  const entry = await readFile(new URL('../entry/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /desktopEntrypoint\.start\(\)/)
  assert.match(entry, /startDesktopRuntime\(startup\.startupContext\(\)\)/)
  assert.match(wiring, /return createDesktopStartupContext\(\{/)
  assert.match(context, /restoreDesktopWindows: restoreDesktopWindowsAtStartup/)
  assert.ok(runtime.indexOf('restoreDesktopWindows(restoreWindowsOptions)') < runtime.indexOf('worker.create('))
  assert.match(restore, /const records = recoverableDesktopWindows\(recovery\)/)
  assert.match(restore, /recovery: \{ projects: record\.projects, activeProject: record\.activeProject, pending: false \}/)
})

test('every class that extends another is declared after its base', async () => {
  const source = await readDesktopCompositionSource()
  for (const match of source.matchAll(/^class (\w+) extends (\w+)/gm)) {
    const base = source.search(new RegExp(`^class ${match[2]}\\b`, 'm'))
    if (base >= 0) assert.ok(base < match.index, `${match[1]} is declared before its base ${match[2]}`)
  }
})

test('a follow window stays open while its Worker is pinned to the same task', async () => {
  const source = await readSchedulerStartupSource()
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))
  const onState = scheduler.slice(scheduler.indexOf('onState: (state) =>'), scheduler.indexOf('onState: (state) =>') + 1200)
  assert.match(onState, /const heldByTask = Boolean\(monitored && orchestrationTaskPins\.lane\(monitored\.slotId\)\) && \(state\.kind === 'settled' \|\| state\.kind === 'task-error'\)/)
  assert.match(onState, /if \(!heldByTask\) closeWorkerMonitorAfterState\(monitored, state\.kind\)/)
  // The monitored entry is the slot's own, never an index into a list that also holds ephemeral browsers.
  assert.doesNotMatch(onState, /closeWorkerMonitorAfterState\(chatGPTWorkerEntries\[worker - 1\]/)
})
