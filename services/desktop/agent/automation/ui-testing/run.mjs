import { captureBrowserState, resetBrowserState, restoreBrowserState } from './browser-session.mjs'
import { printGuidePDF } from './guide.mjs'
import { runSingleTest } from './run-test.mjs'

const RUN_V1 = 'harness.ui-test-run/v1'
const RUN_V2 = 'harness.ui-test-run/v2'

// Executes a UI_TEST_RUN: the prerequisites the backend planned, then the
// selected test, in one isolated in-memory browser partition. After every
// passed test the browser state is handed to the backend to persist; when a
// restored session turns out to be signed out, it is invalidated and the
// whole chain replays from a clean browser once.
export function createUITestRunner(context) {
  const { BrowserWindow, path, app, rm, mkdir, writeFile, wait, post, chat } = context

  async function run(task, entry, key, payload) {
    if (payload?.protocol !== RUN_V1 && payload?.protocol !== RUN_V2) return { status:'failed', error:'invalid UI test payload' }
    const environmentURL = new URL(String(payload.environment?.url || ''))
    const origin = environmentURL.origin
    const fullChain = payload.protocol === RUN_V2 ? payload.full_chain : [{ run_id:payload.run_id, role:'target', test:payload.test }]
    const base = `/api/ui-testing/tasks/${task.task_id}`
    const browser = new BrowserWindow({ show:false, width:1365, height:900, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false, partition:`ui-test-${task.task_id}` } })
    const dir = await taskDir(task.task_id)
    let chatState
    let sequence = 0
    try {
      const credentials = payload.profile?.id ? await post(`${base}/credential`, { run_id:payload.run_id, environment_id:payload.environment.id, profile_id:payload.profile.id }) : {}
      chatState = await chat.start(entry, key)
      const shared = { browser, chatState, key, taskId:task.task_id, payload, origin, credentials, dir, base, post, nextSequence:() => (sequence += 1) }
      let restoredFrom = ''
      let chain = fullChain
      if (payload.protocol === RUN_V2 && payload.restore) {
        try {
          const restored = await post(`${base}/session/restore`, { run_id:payload.run_id })
          await restoreBrowserState(browser.webContents, environmentURL, restored.state)
          restoredFrom = payload.restore.test_id
          chain = payload.chain
        } catch { await resetBrowserState(browser.webContents, environmentURL) }
      } else {
        await browser.loadURL(environmentURL.toString())
      }
      let outcome = await executeChain(shared, chain, fullChain, restoredFrom)
      if (outcome.sessionInvalid) {
        await post(`${base}/session/invalidate`, { run_id:payload.run_id, test_id:restoredFrom }).catch(() => undefined)
        await resetBrowserState(browser.webContents, environmentURL)
        outcome = await executeChain(shared, fullChain, fullChain, '')
      }
      return { status:'done', payload:{ protocol:'harness.ui-test-run-result/v1', run_id:payload.run_id, status:outcome.status } }
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason)
      // A provider cooldown or a human gate is not the test's outcome: the
      // task is rescheduled or paused and the run is replayed afterwards.
      if (reason?.deferMs) return { status:'waiting', delayMs:reason.deferMs, observation:true, error }
      if (reason?.humanAction) return { status:'attention', providerWide:true, error }
      await post(`${base}/result`, { run_id:payload.run_id, result:{ status:'failed', error } }).catch(() => undefined)
      return { status:'failed', error }
    } finally {
      chat.close(chatState, key, task.task_id)
      if (!browser.isDestroyed()) {
        await browser.webContents.session.clearStorageData().catch(() => undefined)
        browser.destroy()
      }
      await rm(dir, { recursive:true, force:true }).catch(() => undefined)
    }
  }

  async function executeChain(shared, chain, fullChain, restoredFrom) {
    for (let i = 0; i < chain.length; i += 1) {
      const item = chain[i]
      const result = await runSingleTest({ ...shared, chat, path, writeFile, wait, item, restoredFrom:i === 0 ? restoredFrom : '' })
      if (result.status === 'session_invalid') return { sessionInvalid:true }
      const report = { status:result.status, error:result.error, screenshots:storedShots(result.screenshots), steps:result.steps }
      if (item.role === 'target') Object.assign(report, await guideFor(shared, item, result))
      result.status = report.status
      await post(`${shared.base}/result`, { run_id:item.run_id, result:report })
      if (result.status !== 'passed') {
        for (const skipped of chain.slice(i + 1)) {
          await post(`${shared.base}/result`, { run_id:skipped.run_id, result:{ status:'skipped', error:`Pré-requisito "${item.test?.title || item.test?.id}" falhou.` } }).catch(() => undefined)
        }
        return { status:item.role === 'target' ? result.status : 'skipped' }
      }
      await saveSession(shared, item)
    }
    return { status:'passed' }
  }

  // Persisting a session is an optimisation for later runs: it never fails this one.
  async function saveSession(shared, item) {
    try {
      const state = await captureBrowserState(shared.browser.webContents, shared.origin)
      if (state) await post(`${shared.base}/session`, { run_id:item.run_id, state })
    } catch { /* the next dependent run replays the prerequisite instead */ }
  }

  // The user guide is its own bundle exchange; a guide that cannot be produced
  // never changes the test's outcome.
  async function guideFor(shared, item, result) {
    try {
      const guide = await requestGuide(shared, item, result)
      // The review captions every capture and judges the run from them.
      const captions = guide.captions || {}
      for (const shot of result.screenshots) shot.caption = captions[shot.name] || shot.caption
      for (const step of result.steps) step.screen_caption = captions[step.screenshot] || step.screen_caption
      const review = { guide_title:guide.title, guide_markdown:guide.markdown, guide_document:guide.document, steps:result.steps, screenshots:storedShots(result.screenshots) }
      if (guide.print_html) review.pdf_base64 = (await printGuidePDF({ BrowserWindow, path, mkdir, writeFile, wait }, shared.dir, guide.print_html, result.screenshots)).toString('base64')
      if (guide.coverage?.added?.length || guide.coverage?.error) console.info(`[ui-testing] coverage task=${shared.taskId} added=${guide.coverage.added?.length || 0}${guide.coverage.error ? ' error' : ''}`)
      if (result.status === 'passed' && guide.verdict?.status === 'failed') Object.assign(review, { status:'failed', error:`Revisão visual: ${guide.verdict.reason}` })
      return review
    } catch (reason) {
      if (reason?.humanAction || reason?.deferMs) throw reason
      console.warn(`[ui-testing] guide task=${shared.taskId} run=${item.run_id} error=${reason instanceof Error ? reason.message : String(reason)}`)
      return {}
    }
  }

  // A guide the backend refuses (for example one that leaves a capture out)
  // is asked for again once, with the refusal attached.
  async function requestGuide(shared, item, result) {
    let previousError = ''
    for (let attempt = 1; ; attempt += 1) {
      const issued = await post(`${shared.base}/guide`, { run_id:item.run_id, status:result.status, previous_error:previousError, steps:result.steps, screenshots:result.screenshots })
      const answer = await chat.exchange(shared.chatState, shared.key, shared.taskId, issued)
      try {
        return await post(`${shared.base}/guide/result`, { filename:answer.filename, bundle_base64:answer.bytes.toString('base64') })
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason)
        if (attempt >= 2 || !message.startsWith('UI testing backend 400')) throw reason
        previousError = message.replace(/^UI testing backend 400:\s*/, '')
      }
    }
  }

  // Measured elements serve only the guide request; the run keeps the captures.
  function storedShots(screenshots) { return screenshots.map(({ elements: _elements, ...shot }) => shot) }

  async function taskDir(id) { const dir = path.join(app.getPath('temp'), 'wharnex-ui-testing', id); await rm(dir, { recursive:true, force:true }).catch(() => undefined); await mkdir(dir, { recursive:true, mode:0o700 }); return dir }
  return { run }
}
