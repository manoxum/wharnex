import { composerLookupSource } from '../../dom/chatgpt-composer-lookup.mjs'

function uploadRequestStage(details) {
  try {
    const url = new URL(String(details?.url || ''))
    const method = String(details?.method || 'POST').toUpperCase()
    if (url.protocol !== 'https:' || !(url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com'))) return ''
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return ''
    const pathname = url.pathname.toLowerCase()
    if (method === 'POST' && pathname === '/backend-api/files') return 'metadata'
    if (method === 'POST' && /^\/backend-api\/files\/[^/]+\/uploaded\/?$/.test(pathname)) return 'complete'
    if (pathname === '/backend-api/files/process_upload_stream'
      || /^\/backend-api\/files\/[^/]*(?:upload|process_upload)[^/]*(?:\/|$)/.test(pathname)
      || /^\/backend-api\/uploads?(?:\/|$)/.test(pathname)) return 'complete'
    return ''
  } catch { return '' }
}

function ambiguousUploadFailure(message) {
  const error = new Error(message)
  error.retryFileSelection = false
  return error
}

export function chatGPTUploadThumbnailScript(filename) {
  const expected = JSON.stringify(String(filename || '').trim())
  return `(() => {
    const expected = ${expected};
    if (!expected) return { visible: false, progress: null, complete: false };
    const value = (node, name) => String(node?.getAttribute?.(name) || '');
    const metadata = (node) => ['data-file-name', 'data-name', 'aria-label', 'title', 'alt'].map((name) => value(node, name));
    ${composerLookupSource()}
    const surface = composer?.closest('[data-composer-surface]') || composer?.closest('form');
    if (!surface) return { visible: false, progress: null, active: false, complete: false };
    const cards = [...surface.querySelectorAll('[data-testid*="upload" i],[data-testid*="attachment" i],[data-testid*="file" i]')];
    // The definitive-chat preview cards currently do not expose a stable
    // filename attribute. Their file icon is structural, however, so this
    // bounded count lets the coordinator compare pre-selection and post-
    // selection composer state without reading the preview or prompt text.
    const markerCount = cards.length + surface.querySelectorAll('svg').length;
    const card = cards.find((node) => [node, ...node.querySelectorAll?.('[data-file-name],[data-name],[aria-label],[title],img[alt]') || []]
      .some((item) => metadata(item).includes(expected)));
    // Current ChatGPT renders a ZIP preview with an indeterminate circular
    // spinner, not a numeric progress bar. The spinner is composer-local and
    // does not require reading the preview filename/prompt text. Its later
    // disappearance is completion evidence only after this same observation
    // has first seen it active.
    const uploadSpinner = surface.querySelector('[role="progressbar"],[aria-busy="true"],svg[class*="animate-spin" i],[class*="animate-spin" i]');
    if (!card) return { visible: true, markerCount, progress: null, active: Boolean(uploadSpinner), complete: false };
    const progressNode = card.matches?.('[role="progressbar"],[aria-valuenow],progress,[data-progress]') ? card
      : card.querySelector?.('[role="progressbar"],[aria-valuenow],progress,[data-progress]');
    const rawProgress = value(progressNode, 'aria-valuenow') || value(progressNode, 'data-progress') || String(progressNode?.value || '');
    const progress = Number(rawProgress);
    const state = [value(card, 'data-state'), value(card, 'data-status'), value(progressNode, 'data-state')].join(' ').toLowerCase();
    const complete = /(?:^|\s)(?:complete|completed|uploaded)(?:\s|$)/.test(state) || (Number.isFinite(progress) && progress >= 100);
    return { visible: true, markerCount, progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null, active: Boolean(uploadSpinner), complete };
  })()`
}

export class ChatGPTUploadCoordinator {
  constructor() { this.pendingByWebContents = new Map(); this.pendingByRequest = new Map() }

  expect(webContentsId, { startTimeoutMs = 20_000, completionTimeoutMs = 90_000, observe, baselineMarkerCount, onProgress = () => {} } = {}) {
    if (!Number.isInteger(webContentsId) || webContentsId < 1) throw new Error('Invalid ChatGPT webContents id')
    this.pendingByWebContents.get(webContentsId)?.finish(new Error('ChatGPT upload observation was superseded'))
    return new Promise((resolve, reject) => {
      const state = {
        webContentsId, requestIds: new Set(), startTimer: undefined, completionTimer: undefined, pollTimer: undefined, lastProgress: null,
        baselineMarkerCount: Number.isFinite(Number(baselineMarkerCount)) ? Number(baselineMarkerCount) : Number.NaN, markerSettles: 0,
        finish: (error, result = { observed: true }) => {
          if (!this.pendingByWebContents.has(webContentsId)) return
          clearTimeout(state.startTimer); clearTimeout(state.completionTimer); clearInterval(state.pollTimer)
          this.pendingByWebContents.delete(webContentsId)
          for (const requestId of state.requestIds) this.pendingByRequest.delete(requestId)
          if (error) reject(error); else resolve(result)
        },
      }
      state.startTimer = setTimeout(() => state.finish(new Error('ChatGPT did not start the file upload before timeout')), startTimeoutMs)
      this.pendingByWebContents.set(webContentsId, state)
      if (typeof observe === 'function') {
        const poll = async () => { try { this.onThumbnail(webContentsId, await observe(), onProgress) } catch { /* network confirmation remains available */ } }
        void poll()
        state.pollTimer = setInterval(() => { void poll() }, 250)
      }
      state.completionTimeoutMs = completionTimeoutMs
    })
  }

  cancel(webContentsId, reason = 'ChatGPT upload observation cancelled') {
    const state = this.pendingByWebContents.get(webContentsId)
    if (!state) return false
    state.finish(new Error(reason)); return true
  }

  stateFor(details) {
    return this.pendingByRequest.get(String(details?.id ?? '')) || this.pendingByWebContents.get(details?.webContentsId)
      || (details?.webContentsId == null && this.pendingByWebContents.size === 1 ? this.pendingByWebContents.values().next().value : undefined)
  }

  begin(state) {
    clearTimeout(state.startTimer)
    if (!state.completionTimer) state.completionTimer = setTimeout(() => state.finish(ambiguousUploadFailure('ChatGPT file upload did not complete before timeout')), state.completionTimeoutMs)
  }

  onThumbnail(webContentsId, thumbnail, onProgress = () => {}) {
    const state = this.pendingByWebContents.get(webContentsId)
    if (!state || thumbnail?.visible !== true) return false
    const markerCount = Number(thumbnail.markerCount)
    const hasNewPreview = Number.isFinite(markerCount) && Number.isFinite(state.baselineMarkerCount) && markerCount > state.baselineMarkerCount
    if (hasNewPreview) {
      this.begin(state)
      if (thumbnail.active !== true) state.markerSettles += 1
      else state.markerSettles = 0
    }
    if (thumbnail.active === true) {
      this.begin(state)
      state.thumbnailActive = true
    } else if (state.thumbnailActive === true) {
      state.finish(undefined, { observed: true, progress: 100, source: 'thumbnail-spinner' })
      return true
    } else if (state.markerSettles >= 2) {
      state.finish(undefined, { observed: true, progress: 100, source: 'thumbnail-card' })
      return true
    } else if (thumbnail.complete === true) this.begin(state)
    const rawProgress = thumbnail.progress
    const progress = rawProgress == null || rawProgress === '' ? Number.NaN : Number(rawProgress)
    if (Number.isFinite(progress) && progress !== state.lastProgress) { state.lastProgress = progress; onProgress({ progress, complete: thumbnail.complete === true }) }
    if (thumbnail.complete === true) state.finish(undefined, { observed: true, progress: Number.isFinite(progress) ? progress : 100, source: 'thumbnail' })
    return true
  }

  onBeforeRequest(details) {
    const stage = uploadRequestStage(details); const state = stage && this.stateFor(details)
    if (!state) return false
    this.begin(state); const requestId = String(details.id); state.requestIds.add(requestId); this.pendingByRequest.set(requestId, state)
    return true
  }

  onCompleted(details) {
    const stage = uploadRequestStage(details); const state = stage && this.stateFor(details)
    if (!state) return false
    if (details.statusCode < 200 || details.statusCode >= 300) state.finish(new Error(`ChatGPT file upload HTTP ${details.statusCode}`))
    else if (stage === 'complete') state.finish()
    return true
  }

  onErrorOccurred(details) {
    const state = uploadRequestStage(details) && this.stateFor(details)
    if (!state) return false
    state.finish(ambiguousUploadFailure(`ChatGPT file upload failed: ${details.error || 'network error'}`)); return true
  }
}
