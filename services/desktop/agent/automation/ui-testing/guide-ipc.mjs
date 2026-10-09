import { sanitizeSessionId } from '../../../security/input.mjs'

// Opens a UI Lab user guide in the Wharnex-owned browser. The renderer names
// only a session, a run and a format from a closed set; the URL is derived
// here from the allowlisted local backend, never taken from the renderer.

const GUIDE_FORMATS = Object.freeze({ html:'guide.html', pdf:'guide.pdf', md:'guide.md' })
const RUN_ID = /^[A-Za-z0-9_-]{1,120}$/

export function uiTestingGuideURL(backendURL, request) {
  const sessionId = sanitizeSessionId(request?.sessionId)
  const runId = String(request?.runId || '')
  const name = Object.hasOwn(GUIDE_FORMATS, request?.format) ? GUIDE_FORMATS[request.format] : ''
  if (!RUN_ID.test(runId) || !name) throw new Error('Pedido de guia UI Lab inválido.')
  return new URL(`/api/sessions/${encodeURIComponent(sessionId)}/ui-testing/assets/${encodeURIComponent(runId)}/${name}`, backendURL).href
}

export function registerUITestingGuideIPC({ ipcMain, trustedSender, shell, backendURL }) {
  ipcMain.handle('wharnex:ui-testing:open-guide', async (event, request) => {
    trustedSender(event)
    await shell.openExternal(uiTestingGuideURL(backendURL, request))
    return { ok:true }
  })
}
