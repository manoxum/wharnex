import { describe, expect, it } from 'vitest'
import { workspaceDragEndedOutside, workspaceSurfaceKey, workspaceSurfaceRequest, workspaceSurfaceTarget, workspaceSurfaceURL } from './workspaceSurface'

describe('workspaceSurface', () => {
  it('parses focused chat and split host', () => {
    expect(workspaceSurfaceRequest('?surface=chat&surfaceHost=split&chat=chat-2')).toEqual({ kind: 'chat', host: 'split', chatId: 'chat-2' })
  })

  it('uses stable per-project surface targets and tab keys', () => {
    const target = workspaceSurfaceTarget('/workspace/demo', { kind: 'chat', chatId: 'chat-2' })
    expect(target).toEqual({ projectPath: '/workspace/demo', kind: 'chat', chatId: 'chat-2' })
    expect(workspaceSurfaceKey(target)).toBe('chat:chat-2')
    expect(workspaceSurfaceKey({ kind: 'editor', path: 'src/App.tsx' })).toBe('editor:src/App.tsx')
    expect(workspaceSurfaceKey({ kind: 'terminal' })).toBe('terminal:primary')
  })

  it('detects when a dragged tab leaves the current window', () => {
    expect(workspaceDragEndedOutside({ clientX: 1200, clientY: 400 }, { width: 1000, height: 800 })).toBe(true)
    expect(workspaceDragEndedOutside({ clientX: 0, clientY: 0 }, { width: 1000, height: 800 })).toBe(true)
    expect(workspaceDragEndedOutside({ clientX: 500, clientY: 400 }, { width: 1000, height: 800 })).toBe(false)
  })

  it('builds an embedded surface URL without leaking stale selectors', () => {
    const url = new URL(workspaceSurfaceURL({ projectPath: '/workspace/demo', kind: 'editor', path: 'src/App.tsx' }, 'window', 'http://127.0.0.1:5173/?chat=old&surface=chat'))
    expect(url.searchParams.get('embedded')).toBe('1')
    expect(url.searchParams.get('active')).toBe('1')
    expect(url.searchParams.get('project')).toBe('/workspace/demo')
    expect(url.searchParams.get('surface')).toBe('editor')
    expect(url.searchParams.get('surfaceHost')).toBe('window')
    expect(url.searchParams.get('path')).toBe('src/App.tsx')
    expect(url.searchParams.has('chat')).toBe(false)
  })
})
