import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createUITestRunner } from './run.mjs'

const taskID = `cat_${'c'.repeat(20)}`
const login = { run_id:'run_x_d1', role:'dependency', test:{ id:'login', title:'Login', goal:'Entrar' } }
const create = { run_id:'run_x', role:'target', test:{ id:'create-item', title:'Criar item', goal:'Criar' } }

function harness({ restore, actions, restoreFails = false, clickFails = false, verdict = { status:'passed', reason:'ok' } }) {
  const guideShots = []
  const log = { posts:[], exchanges:[], cleared:0, cookies:[], closed:0 }
  class FakeWindow {
    constructor() {
      this.url = 'about:blank'
      const self = this
      this.webContents = {
        getURL: () => self.url,
        loadURL: async (url) => { self.url = String(url) },
        capturePage: async () => ({ resize: () => ({ toPNG: () => Buffer.from('png') }) }),
        printToPDF: async () => Buffer.from('pdf'),
        executeJavaScript: async (script) => script.includes('local_storage: dump')
          ? { url:self.url, local_storage:{ token:'t' }, session_storage:{} }
          : script.includes('localStorage.setItem') ? true
          : script.includes('querySelectorAll(selector).length') ? [{ selector:'#login', tag:'button' }]
          : clickFails ? { ok:false, error:'selector not found: #missing' } : { ok:true, outcome:'ok' },
        session: {
          cookies: { get: async () => [{ name:'sid', value:'v', domain:'app.test' }, { name:'ad', value:'x', domain:'ads.example' }], set: async (cookie) => { log.cookies.push(cookie) } },
          clearStorageData: async () => { log.cleared += 1 },
        },
      }
    }
    loadURL(url) { return this.webContents.loadURL(url) }
    isDestroyed() { return false }
    destroy() {}
  }
  const queue = [...actions]
  const issued = (kind, sequence) => ({ request:{ request_filename:`whx_ui_test_${kind}_req_${taskID}${sequence ? `_${sequence}` : ''}.zip`, result_filename:`whx_ui_test_${kind}_res_${taskID}${sequence ? `_${sequence}` : ''}.zip` }, bootstrap:'b', archive_base64:'eA==' })
  const runner = createUITestRunner({
    BrowserWindow:FakeWindow, path, app:{ getPath: () => '/tmp' }, rm:async () => {}, mkdir:async () => {}, writeFile:async () => {}, wait:async () => {},
    chat: {
      start: async () => ({ conversationUrl:'https://chatgpt.com/c/run' }),
      exchange: async (_state, _key, task, request) => {
        log.exchanges.push(request.request.result_filename); assert.equal(task, taskID)
        if (log.timeoutOnce && !log.timedOut) { log.timedOut = true; throw new Error(`ChatGPT did not provide ${request.request.result_filename} before the UI test timeout`) }
        return { filename:request.request.result_filename, bytes:Buffer.from('zip') }
      },
      close: () => { log.closed += 1 },
    },
    post: async (pathname, body) => {
      const route = pathname.replace(`/api/ui-testing/tasks/${taskID}`, '')
      log.posts.push([route, body])
      if (route === '/step') return issued('step', body.sequence)
      if (route === '/step/result') {
        const next = queue.shift()
        if (next === 'invalid') throw new Error('UI testing backend 400: {"error":"decode UI test answer"}')
        if (next === 'upload-limit') throw new Error('ChatGPT upload failed after 5 attempts: ChatGPT did not start the file upload before timeout')
        const actions = Array.isArray(next) ? next : [next]
        return { actions, screen_caption:`Ecrã antes de ${actions[0].action}` }
      }
      if (route === '/guide') { guideShots.push(body.screenshots); return issued('guide', 0) }
      if (route === '/guide/result' && log.guideRefusedOnce && !log.guideRefused) { log.guideRefused = true; throw new Error('UI testing backend 400: {"error":"the guide must show every capture"}') }
      if (route === '/guide/result') return { title:'Criar um item', markdown:'# Criar', captions:Object.fromEntries((guideShots.at(-1) || []).map((shot) => [shot.name, `Legenda de ${shot.name}`])), verdict }
      if (route === '/session/restore') {
        if (restoreFails) throw new Error('UI testing backend 409')
        return { state:{ url:'https://app.test/dashboard', cookies:[{ name:'sid', value:'v', domain:'app.test' }], local_storage:{ token:'t' }, session_storage:{} } }
      }
      return {}
    },
  })
  const payload = { protocol:'harness.ui-test-run/v2', run_id:'run_x', test:create.test, environment:{ id:'web', name:'Web', url:'https://app.test/' },
    profile:{ id:'admin', label:'Admin', role:'admin' }, full_chain:[login, create], chain:restore ? [create] : [login, create], restore, max_steps:4 }
  return { log, execute: () => runner.run({ task_id:taskID }, {}, 'owned', payload) }
}

const finish = (status) => ({ action:'finish', status, caption:status })
const restorePoint = { session_id:'uts_1', test_id:'login', covers:['login'] }
const outcomes = (log) => log.posts.filter(([route]) => !route.startsWith('/step')).map(([route, body]) => `${route}${body.run_id ? `:${body.run_id}` : ''}${body.result ? `:${body.result.status}` : ''}`)

test('a restored session runs only the selected test, through bundle exchanges only', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:[finish('passed')] })
  const result = await execute()
  assert.equal(result.payload.status, 'passed')
  assert.deepEqual(outcomes(log), ['/credential:run_x', '/session/restore:run_x', '/guide:run_x', '/guide/result', '/result:run_x:passed', '/session:run_x'])
  assert.deepEqual(log.exchanges, [`whx_ui_test_step_res_${taskID}_1.zip`, `whx_ui_test_guide_res_${taskID}.zip`])
  const step = log.posts.find(([route]) => route === '/step')[1]
  assert.equal(step.restored_from, 'login')
  assert.equal(step.current_url, 'https://app.test/dashboard')
  const report = log.posts.find(([route, body]) => route === '/result' && body.run_id === 'run_x')[1].result
  assert.equal(report.guide_title, 'Criar um item')
  const saved = log.posts.find(([route]) => route === '/session')[1].state
  assert.deepEqual(saved.cookies.map((cookie) => cookie.name), ['sid'], 'cookies of other sites must never be persisted')
  assert.equal(log.closed, 1)
  assert.equal(report.steps[0].screen_caption, 'Legenda de step-01.png', 'the review captions every capture')
  assert.equal(report.screenshots[0].caption, 'Legenda de step-01.png')
})

test('a signed-out restored session is invalidated and the whole chain replays', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:[finish('session_invalid'), finish('passed'), finish('passed')] })
  const result = await execute()
  assert.equal(result.payload.status, 'passed')
  assert.deepEqual(outcomes(log).filter((entry) => !entry.startsWith('/guide')), ['/credential:run_x', '/session/restore:run_x', '/session/invalidate:run_x', '/result:run_x_d1:passed', '/session:run_x_d1', '/result:run_x:passed', '/session:run_x'])
  const sequences = log.posts.filter(([route]) => route === '/step').map(([, body]) => body.sequence)
  assert.deepEqual(sequences, [1, 2, 3], 'every exchange in a task has its own sequence')
})

test('an unavailable session falls back to the full chain', async () => {
  const { log, execute } = harness({ restore:restorePoint, restoreFails:true, actions:[finish('passed'), finish('passed')] })
  await execute()
  assert.deepEqual(outcomes(log).filter((entry) => entry.startsWith('/result')), ['/result:run_x_d1:passed', '/result:run_x:passed'])
})

test('a failed prerequisite blocks the selected test without running it', async () => {
  const { log, execute } = harness({ restore:undefined, actions:[finish('failed')] })
  const result = await execute()
  assert.equal(result.payload.status, 'skipped')
  assert.deepEqual(outcomes(log), ['/credential:run_x', '/result:run_x_d1:failed', '/result:run_x:skipped'])
})

test('session_invalid is only honoured right after a restore', async () => {
  const { log, execute } = harness({ restore:undefined, actions:[finish('session_invalid')] })
  await execute()
  assert.deepEqual(outcomes(log).slice(1, 2), ['/result:run_x_d1:failed'])
})

test('a refused answer is asked again once, for the same page, with the refusal attached', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:['invalid', finish('passed')] })
  const result = await execute()
  assert.equal(result.payload.status, 'passed')
  const steps = log.posts.filter(([route]) => route === '/step').map(([, body]) => body)
  assert.deepEqual(steps.map((body) => [body.sequence, body.iteration]), [[1, 1], [2, 1]])
  assert.match(steps[1].previous_error, /decode UI test answer/)
})

test('a failed action is fed back to the next iteration instead of failing the test', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:[{ action:'click', selector:'#missing', caption:'clicar' }, finish('passed')], clickFails:true })
  const result = await execute()
  assert.equal(result.payload.status, 'passed')
  const second = log.posts.filter(([route]) => route === '/step')[1][1]
  assert.match(second.history[0].outcome, /^falhou: /)
  assert.ok(Array.isArray(second.elements))
})

test('a planned sequence runs without new exchanges and every capture is captioned by the review', async () => {
  const plan = [{ action:'click', selector:'#a', caption:'abrir' }, { action:'fill', selector:'#b', value:'x', caption:'preencher' }, finish('passed')]
  const { log, execute } = harness({ restore:restorePoint, actions:[plan] })
  const result = await execute()
  assert.equal(result.payload.status, 'passed')
  assert.equal(log.posts.filter(([route]) => route === '/step').length, 1, 'one exchange for the whole plan')
  const report = log.posts.find(([route, body]) => route === '/result' && body.run_id === 'run_x')[1].result
  assert.deepEqual(report.steps.map((step) => step.screenshot), ['step-01.png', 'step-02.png', 'step-03.png'])
  assert.ok(report.screenshots.every((shot) => shot.caption.startsWith('Legenda de')))
})

test('the visual review can overrule a run that only looked successful', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:[finish('passed')], verdict:{ status:'failed', reason:'O painel não mostra o item criado.' } })
  const result = await execute()
  assert.equal(result.payload.status, 'failed')
  const report = log.posts.find(([route, body]) => route === '/result' && body.run_id === 'run_x')[1].result
  assert.match(report.error, /Revisão visual: O painel não mostra/)
})

test('an exhausted upload allowance defers the run instead of failing it', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:['upload-limit'] })
  log.exchangeFails = true
  const result = await execute()
  assert.equal(result.status, 'waiting')
  assert.ok(result.delayMs >= 60_000)
  assert.equal(log.posts.some(([route]) => route === '/result'), false)
})

test('a response that never arrived is asked again once before the test fails', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:[finish('passed')] })
  log.timeoutOnce = true
  const result = await execute()
  assert.equal(result.payload.status, 'passed')
  assert.deepEqual(log.posts.filter(([route]) => route === '/step').map(([, body]) => body.sequence), [1, 2])
})

test('a refused guide is asked again once with the refusal attached', async () => {
  const { log, execute } = harness({ restore:restorePoint, actions:[finish('passed')] })
  log.guideRefusedOnce = true
  await execute()
  const guides = log.posts.filter(([route]) => route === '/guide').map(([, body]) => body)
  assert.equal(guides.length, 2)
  assert.match(guides[1].previous_error, /every capture/)
  const report = log.posts.find(([route, body]) => route === '/result' && body.run_id === 'run_x')[1].result
  assert.equal(report.guide_title, 'Criar um item')
})
