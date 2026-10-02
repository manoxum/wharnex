import { executeUIAction, parseUIAction } from './actions.mjs'
import { createUITestingChat } from './chatgpt.mjs'
import { renderGuidePDF } from './guide.mjs'

export function createUITestingWorker(context) {
  const { BrowserWindow, BACKEND_URL, fetch, path, app, rm, mkdir, writeFile, wait } = context
  const chat = createUITestingChat(context)

  async function executeUITestingTask(task, entry, key, payload) {
    if (task.type === 'UI_TEST_DISCOVER') return discover(task, entry, key, payload)
    if (task.type === 'UI_TEST_RUN') return run(task, entry, key, payload)
    return { status:'failed', error:'unsupported UI testing task' }
  }

  async function discover(task, entry, key, payload) {
    if (payload?.protocol !== 'harness.ui-test-discovery/v1') return { status:'failed', error:'invalid UI discovery payload' }
    const dir = await taskDir(task.task_id); const archive = path.join(dir, 'context.zip')
    try {
      const bytes = Buffer.from(String(payload.archive_base64 || ''), 'base64'); if (!bytes.length) throw new Error('UI discovery has no context archive')
      await writeFile(archive, bytes, { mode:0o600 })
      const state = await chat.start(entry, key); const answer = await chat.ask(state, key, String(payload.bootstrap || ''), archive)
      const discovered = parseJSON(answer); discovered.context_sha256 = String(payload.context_sha256 || '')
      await post(`/api/ui-testing/tasks/${task.task_id}/discovery`, discovered)
      return { status:'done', payload:{ protocol:'harness.ui-test-discovery-result/v1', environments:discovered.environments?.length || 0, tests:discovered.tests?.length || 0 } }
    } finally { await rm(dir, { recursive:true, force:true }).catch(() => undefined) }
  }

  async function run(task, entry, key, payload) {
    if (payload?.protocol !== 'harness.ui-test-run/v1') return { status:'failed', error:'invalid UI test payload' }
    const url = new URL(String(payload.environment?.url || '')); const origin = url.origin
    const browser = new BrowserWindow({ show:false, width:1365, height:900, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false } })
    const dir = await taskDir(task.task_id); const screenshots = []; const steps = []; let status = 'failed'; let error = ''
    try {
      const credentials = payload.profile?.id ? await post(`/api/ui-testing/tasks/${task.task_id}/credential`, { run_id:payload.run_id, environment_id:payload.environment.id, profile_id:payload.profile.id }) : {}
      await browser.loadURL(url.toString()); assertOrigin(browser.webContents.getURL(), origin); const state = await chat.start(entry, key)
      for (let index=1; index<=Math.min(24, Number(payload.max_steps)||24); index+=1) {
        assertOrigin(browser.webContents.getURL(), origin)
        const image = (await browser.webContents.capturePage()).resize({ width:1024 })
        const png = image.toPNG(); const name = `step-${String(index).padStart(2,'0')}.png`; const file = path.join(dir, name)
        await writeFile(file, png, { mode:0o600 }); screenshots.push({ name, caption:`Estado antes da iteração ${index}`, content_base64:png.toString('base64') })
        const prompt = iterationPrompt(payload, steps, browser.webContents.getURL(), index)
        const action = parseUIAction(await chat.ask(state, key, prompt, file))
        const outcome = await executeUIAction(browser.webContents, action, { origin, credentials, wait })
        steps.push({ index, action:action.action, caption:action.caption || '', outcome:outcome.outcome || '', screenshot:name })
        screenshots[screenshots.length-1].caption = action.caption || outcome.outcome || screenshots[screenshots.length-1].caption
        if (outcome.done) { status = outcome.status; break }
        await wait(300)
      }
      if (!steps.length || !['passed','failed'].includes(status)) { status='failed'; error='test reached the iteration limit without finish' }
      const guidePrompt = `Com base em TODA esta conversa, nas capturas que viste e neste registo final ${JSON.stringify(steps)}, produza um user guide em Markdown para a funcionalidade testada. Inclua pré-requisitos, passos numerados, resultado esperado e referências às capturas pelos nomes. Não exponha nem invente credenciais.`
      const guide = await chat.ask(state, key, guidePrompt)
      const title = String(payload.test?.title || 'Guia de utilização'); const pdf = await renderGuidePDF(BrowserWindow, title, guide, screenshots)
      await post(`/api/ui-testing/tasks/${task.task_id}/result`, { run_id:payload.run_id, result:{ status, error, guide_title:title, guide_markdown:guide, pdf_base64:pdf.toString('base64'), screenshots, steps } })
      return { status:'done', payload:{ protocol:'harness.ui-test-run-result/v1', run_id:payload.run_id, status } }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
      await post(`/api/ui-testing/tasks/${task.task_id}/result`, { run_id:payload.run_id, result:{ status:'failed', error, screenshots, steps } }).catch(() => undefined)
      return { status:'failed', error }
    } finally { if (!browser.isDestroyed()) browser.destroy(); await rm(dir, { recursive:true, force:true }).catch(() => undefined) }
  }

  async function taskDir(id) { const dir=path.join(app.getPath('temp'),'wharnex-ui-testing',id); await rm(dir,{recursive:true,force:true}).catch(()=>undefined); await mkdir(dir,{recursive:true,mode:0o700}); return dir }
  async function post(pathname, body) { const response=await fetch(`${BACKEND_URL}${pathname}`,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)}); if(!response.ok) throw new Error(`UI testing backend ${response.status}: ${(await response.text()).slice(0,300)}`); return response.json() }
  return { executeUITestingTask }
}

function parseJSON(text) { const fence=String.fromCharCode(96).repeat(3); let raw=String(text||'').trim(); if(raw.startsWith(fence)) raw=raw.slice(fence.length).replace(/^json\s*/i,'').trimStart(); if(raw.endsWith(fence)) raw=raw.slice(0,-fence.length).trimEnd(); return JSON.parse(raw) }
function iterationPrompt(payload, steps, currentURL, index) { return `És o controlador de um teste real de UI. Objetivo: ${payload.test?.goal}. Ambiente: ${payload.environment?.name}. Perfil disponível por referência: ${payload.profile?.label || 'sem autenticação'} (${payload.profile?.role || 'public'}). URL atual: ${currentURL}. Histórico: ${JSON.stringify(steps.slice(-8))}. Analisa a captura anexada e devolve SOMENTE uma ação JSON. Ações permitidas: navigate{url}, click{selector}, fill{selector,value}, fill_credential{selector,field:username|password}, press{selector,key:Enter|Escape|Tab|ArrowDown|ArrowUp|Space}, wait{ms}, assert_text{selector,text}, finish{status:passed|failed,caption}. Nunca peças nem escrevas a senha; usa fill_credential. Iteração ${index}.` }

function assertOrigin(value, origin) { if (new URL(String(value || origin)).origin !== origin) throw new Error('UI test navigation left the configured environment origin') }
