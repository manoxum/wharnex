export type WorkspaceSurfaceKind = 'chat' | 'editor' | 'terminal'
export type WorkspaceSurfaceHost = 'window' | 'split'
export type WorkspaceSplitDirection = 'vertical' | 'horizontal'
export type WorkspaceSurfaceTransferPoint = { screenX: number; screenY: number }

export type WorkspaceSurfaceRequest = {
  kind: WorkspaceSurfaceKind
  host: WorkspaceSurfaceHost
  chatId?: string
  path?: string
}

export type WorkspaceSurfaceTarget = {
  projectPath: string
  kind: WorkspaceSurfaceKind
  chatId?: string
  path?: string
}


export function workspaceSurfaceTarget(projectPath: string, request: Pick<WorkspaceSurfaceRequest, 'kind' | 'chatId' | 'path'>): WorkspaceSurfaceTarget {
  return { projectPath: cleanValue(projectPath), kind: request.kind, ...(request.chatId ? { chatId: cleanValue(request.chatId) } : {}), ...(request.path ? { path: cleanValue(request.path) } : {}) }
}

export function workspaceSurfaceKey(target: Pick<WorkspaceSurfaceTarget, 'kind' | 'chatId' | 'path'>) {
  if (target.kind === 'chat') return `chat:${cleanValue(target.chatId || '')}`
  if (target.kind === 'editor') return `editor:${cleanValue(target.path || '')}`
  return 'terminal:primary'
}

export function workspaceSurfaceRequest(search = window.location.search): WorkspaceSurfaceRequest | undefined {
  try {
    const params = new URLSearchParams(search)
    const kind = params.get('surface')
    if (kind !== 'chat' && kind !== 'editor' && kind !== 'terminal') return undefined
    const host = params.get('surfaceHost') === 'split' ? 'split' : 'window'
    const chatId = cleanValue(params.get('chat'))
    const path = cleanValue(params.get('path'))
    return { kind, host, ...(chatId ? { chatId } : {}), ...(path ? { path } : {}) }
  } catch { return undefined }
}

export function workspaceSurfaceURL(target: WorkspaceSurfaceTarget, host: WorkspaceSurfaceHost, base = window.location.href) {
  const url = new URL(base)
  url.searchParams.set('embedded', '1')
  url.searchParams.set('active', '1')
  url.searchParams.set('project', target.projectPath)
  url.searchParams.set('surface', target.kind)
  url.searchParams.set('surfaceHost', host)
  if (target.chatId) url.searchParams.set('chat', target.chatId)
  else url.searchParams.delete('chat')
  if (target.path) url.searchParams.set('path', target.path)
  else url.searchParams.delete('path')
  return url.toString()
}

function cleanValue(value: string | null) {
  const normalized = String(value || '').trim()
  return normalized ? normalized.slice(0, 4096) : ''
}

export function workspaceDragEndedOutside(event: { clientX: number; clientY: number }, viewport = { width: window.innerWidth, height: window.innerHeight }) {
  return event.clientX <= 0 || event.clientY <= 0 || event.clientX >= viewport.width || event.clientY >= viewport.height
}
