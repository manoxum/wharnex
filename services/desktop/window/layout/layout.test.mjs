import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDesktopWindowLayout } from './layout.mjs'

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }

test('window layout persists normal bounds and maximized state per durable window', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-window-layout-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const live = { id: 'primary', transientSurface: false, window: {
    isDestroyed: () => false,
    getNormalBounds: () => ({ x: 20, y: 30, width: 1540, height: 960 }),
    isMaximized: () => true,
  } }
  const transient = { id: 'surface', transientSurface: true, window: { isDestroyed: () => false } }
  const windows = new Map([[live.id, live], [transient.id, transient]])
  const layout = createDesktopWindowLayout({ userDataPath: () => dir, windows, displays: () => [display] })

  layout.persist()
  const saved = JSON.parse(await readFile(path.join(dir, 'wharness-window-layout.json'), 'utf8'))
  assert.deepEqual(saved, {
    version: 3, windows: ['primary'],
    bounds: { primary: { x: 20, y: 30, width: 1540, height: 960 } },
    maximized: { primary: true },
  })
  assert.deepEqual(layout.loadWindowLayout(), ['primary'])
  assert.deepEqual(layout.loadWindowPlacement('primary'), { ...saved.bounds.primary, maximized: true })
})

test('window layout keeps old sizes and avoids reopening a window off screen', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-window-layout-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, 'wharness-window-layout.json'), JSON.stringify({
    windows: ['primary', '../invalid'], sizes: { primary: { x: 5000, y: 5000, width: 1200, height: 800 } },
  }))
  const layout = createDesktopWindowLayout({ userDataPath: () => dir, windows: new Map(), displays: () => [display] })
  assert.deepEqual(layout.loadWindowLayout(), ['primary'])
  assert.deepEqual(layout.loadWindowPlacement('primary'), { width: 1540, height: 960, maximized: false })
})

test('window creation still uses the layout module and persists live movement', async () => {
  const [main, runtime, layout, create] = await Promise.all([
    readFile(new URL('../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../composition/window/runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./layout.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../lifecycle/create/window.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(main, /createDesktopWindowRuntime\(\{/)
  assert.match(runtime, /const persistWindowLayout = desktopWindowLayout\.persist/)
  assert.match(runtime, /const loadWindowPlacement = desktopWindowLayout\.loadWindowPlacement/)
  assert.match(main, /const createWindow = createDesktopWindowCreator\(\{[\s\S]*loadWindowPlacement[\s\S]*scheduleWindowLayoutPersistence/)
  assert.match(layout, /JSON\.stringify\(\{ version: 3, windows: validIds, bounds, maximized \}\)/)
  assert.match(layout, /getNormalBounds/)
  assert.match(layout, /function loadWindowPlacement\(id\)/)
  assert.match(create, /const initialWindowPlacement = surface \? \{ width: 1280, height: 820, maximized: false \} : loadWindowPlacement\(id\)/)
  assert.match(create, /width: initialWindowPlacement\.width/)
  assert.match(create, /height: initialWindowPlacement\.height/)
  assert.match(create, /win\.on\('resize', scheduleWindowLayoutPersistence\)/)
  assert.match(create, /win\.on\('move', scheduleWindowLayoutPersistence\)/)
  assert.match(create, /if \(!surface && initialWindowPlacement\.maximized\) win\.maximize\(\)/)
  assert.doesNotMatch(create, /windowStatePersistence/)
})
