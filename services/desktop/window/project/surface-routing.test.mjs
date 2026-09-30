import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceSurfaceRouting } from './surface-routing.mjs'

test('surface routing normalizes bounded project and surface identifiers', () => {
  const routing = createWorkspaceSurfaceRouting({
    canonicalProjectPath: (value) => `/canonical${value}`,
    windows: new Map(), getFocusedWindow: () => undefined,
  })
  assert.deepEqual(routing.normalizedWorkspaceSurface({ projectPath: '/p', kind: 'editor', path: '///src/App.tsx' }), {
    projectPath: '/canonical/p', kind: 'editor', path: 'src/App.tsx',
  })
  assert.throws(() => routing.normalizedWorkspaceSurface({ kind: 'chat', chatId: '  ' }), /Chat inválido/)
  assert.throws(() => routing.normalizedWorkspaceSurface({ kind: 'editor', path: '  ' }), /Ficheiro inválido/)
  assert.throws(() => routing.normalizedWorkspaceSurface({ kind: 'unknown' }), /Tipo de superfície inválido/)
})

test('screen routing prefers the focused eligible window and rejects invalid coordinates', () => {
  const windowFor = (bounds) => ({ isDestroyed: () => false, getBounds: () => bounds })
  const first = windowFor({ x: 0, y: 0, width: 100, height: 100 })
  const focused = windowFor({ x: 0, y: 0, width: 100, height: 100 })
  const routing = createWorkspaceSurfaceRouting({
    canonicalProjectPath: (value) => value,
    windows: new Map([['first', { id: 'first', window: first }], ['focused', { id: 'focused', window: focused }]]),
    getFocusedWindow: () => focused,
  })
  assert.equal(routing.desktopWindowAtScreenPoint({ x: 10, y: 10 })?.id, 'focused')
  assert.equal(routing.desktopWindowAtScreenPoint({ x: 10, y: 10 }, 'focused')?.id, 'first')
  assert.equal(routing.desktopWindowAtScreenPoint({ x: 100, y: 10 }), undefined)
  assert.equal(routing.desktopWindowAtScreenPoint({ x: 'invalid', y: 10 }), undefined)
})
