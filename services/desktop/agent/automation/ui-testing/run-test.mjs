import { executeUIAction, parseUIAction } from './actions.mjs'
import { capturePageElements } from './page-elements.mjs'

const MAX_EXCHANGES = 8
const MAX_ACTIONS = 40

// Runs one test of a chain inside an already-prepared browser. Each exchange
// sends the page state and receives a planned sequence of actions, which runs
// without coming back until it ends, finishes or an action fails; then a new
// plan is asked from the new state. Every action gets the capture of the
// screen it acted on, with the page's elements measured at that moment; GPT
// captions the first capture of each plan here and every capture in the
// guide review. Provider gates and cooldowns escape to
// the run, which owns the whole task's outcome.
export async function runSingleTest({ browser, chat, chatState, key, taskId, base, post, nextSequence, payload, item, restoredFrom, origin, credentials, dir, path, writeFile, wait }) {
  const steps = []
  const screenshots = []
  const capture = async () => {
    assertOrigin(browser.webContents.getURL(), origin)
    const png = (await browser.webContents.capturePage()).resize({ width:1024 }).toPNG()
    const name = `step-${String(screenshots.length + 1).padStart(2, '0')}.png`
    await writeFile(path.join(dir, `${item.run_id}-${name}`), png, { mode:0o600 })
    // The elements measured with each capture let the guide mark them on it.
    const elements = await capturePageElements(browser.webContents)
    screenshots.push({ name, caption:'', content_base64:png.toString('base64'), elements })
    return { name, png, elements }
  }
  try {
    for (let exchanges = 0; exchanges < MAX_EXCHANGES && steps.length < MAX_ACTIONS; exchanges += 1) {
      const shot = await capture()
      const state = { run_id:item.run_id, iteration:exchanges + 1, current_url:browser.webContents.getURL(), restored_from:restoredFrom || '', history:steps, elements:shot.elements, screenshot_base64:shot.png.toString('base64') }
      const decision = await decideAction({ chat, chatState, key, taskId, base, post, nextSequence, state })
      const screenCaption = String(decision.screen_caption || '').trim().slice(0, 400)
      screenshots[screenshots.length - 1].caption = screenCaption
      const planned = Array.isArray(decision.actions) ? decision.actions : []
      for (let i = 0; i < planned.length && steps.length < MAX_ACTIONS; i += 1) {
        const screenshot = i === 0 ? shot.name : (await capture()).name
        const action = parseUIAction(JSON.stringify(planned[i]), { allowSessionInvalid:Boolean(restoredFrom) && i === 0 })
        const outcome = await attemptAction(browser.webContents, action, { origin, credentials, wait })
        steps.push({ index:steps.length + 1, action:action.action, caption:action.caption || '', screen_caption:i === 0 ? screenCaption : '', outcome:outcome.outcome || '', screenshot, selector:action.selector || '' })
        if (outcome.done) return { status:outcome.status, error:outcome.status === 'passed' ? '' : (action.caption || ''), steps, screenshots }
        if (outcome.failed) break
        await wait(300)
      }
    }
    return { status:'failed', error:'test reached its exchange or action limit without finish', steps, screenshots }
  } catch (reason) {
    if (reason?.humanAction || reason?.deferMs) throw reason
    const message = reason instanceof Error ? reason.message : String(reason)
    // The account upload limit is the provider's, not the test's outcome:
    // the run waits out the gate's window and is replayed afterwards.
    if (reason?.uploadLimit) throw Object.assign(new Error(message), { deferMs:reason.delayMs })
    return { status:'failed', error:message, steps, screenshots }
  }
}

// A failed action (a selector that matched nothing, a failed assertion) is
// feedback for the next plan, not the test's verdict. Leaving the environment
// origin stays fatal.
async function attemptAction(wc, action, options) {
  try {
    return await executeUIAction(wc, action, options)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (/origin/.test(message)) throw reason
    return { outcome:`falhou: ${message}`.slice(0, 300), failed:true }
  }
}

// One exchange. An answer the backend refuses (400) is asked for again once,
// for the same page state, with the refusal attached.
async function decideAction({ chat, chatState, key, taskId, base, post, nextSequence, state }) {
  let previousError = ''
  for (let attempt = 1; ; attempt += 1) {
    const sequence = nextSequence()
    const issued = await post(`${base}/step`, { ...state, sequence, previous_error:previousError })
    let answer
    try {
      answer = await chat.exchange(chatState, key, taskId, issued)
    } catch (reason) {
      // A response that never arrived is asked again once, as a new exchange.
      const message = reason instanceof Error ? reason.message : String(reason)
      if (attempt >= 2 || !/before the UI test timeout/.test(message)) throw reason
      continue
    }
    try {
      return await post(`${base}/step/result`, { sequence, filename:answer.filename, bundle_base64:answer.bytes.toString('base64') })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (attempt >= 2 || !message.startsWith('UI testing backend 400')) throw reason
      previousError = message.replace(/^UI testing backend 400:\s*/, '')
    }
  }
}

export function assertOrigin(value, origin) {
  if (new URL(String(value || origin)).origin !== origin) throw new Error('UI test navigation left the configured environment origin')
}
