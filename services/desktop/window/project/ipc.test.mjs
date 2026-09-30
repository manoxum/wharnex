import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('renderer window controls are closed preload IPC operations', async () => {
  const [source, preload] = await Promise.all([
    readFile(new URL('../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
  ])
  const windowIPC = await readFile(new URL('./ipc.mjs', import.meta.url), 'utf8')
  const shellIPC = await readFile(new URL('../control/ipc.mjs', import.meta.url), 'utf8')
  const windowIPCComposition = await readFile(new URL('../../composition/ipc/window.mjs', import.meta.url), 'utf8')
  assert.match(windowIPC, /ipcMain\.handle\('wharness:windows:minimize'/)
  assert.match(windowIPC, /ipcMain\.handle\('wharness:windows:toggle-maximize'/)
  assert.match(windowIPC, /ipcMain\.handle\('wharness:windows:close'/)
  assert.match(source, /createDesktopEntrypointRuntime\(\{/)
  assert.match(await readFile(new URL('../../composition/entry/runtime.mjs', import.meta.url), 'utf8'), /createDesktopIPCRegistrar\(\{ \.\.\.deps, \.\.\.browser, \.\.\.window \}\)/)
  assert.match(windowIPCComposition, /registerDesktopShellIPC\(\{/)
  assert.match(shellIPC, /ipcMain\.handle\('wharness:windows:activate-self-evolution'/)
  assert.match(preload, /minimize: \(\) => invoke\('wharness:windows:minimize'\)/)
  assert.match(preload, /toggleMaximize: \(\) => invoke\('wharness:windows:toggle-maximize'\)/)
  assert.match(preload, /close: \(\) => invoke\('wharness:windows:close'\)/)
  assert.match(preload, /recovery: \(\) => invoke\('wharness:windows:recovery'\)/)
  assert.match(preload, /ipcRenderer\.on\('wharness:windows:close-project', handler\)/)
  assert.match(preload, /activateSelfEvolution: \(impacts\) => invoke\('wharness:windows:activate-self-evolution'/)
  const activation = shellIPC.slice(shellIPC.indexOf("ipcMain.handle('wharness:windows:activate-self-evolution'"))
  assert.match(activation, /impacts\.includes\('desktop'\)[\s\S]*await scheduleDesktopCoordinatorRelaunch\(\)[\s\S]*app\.exit\(0\)/)
  assert.doesNotMatch(activation, /app\.relaunch\(/)
  assert.match(activation, /impacts\.includes\('frontend'\)[\s\S]*webContents\.reload\(\)/)
  assert.match(activation, /await waitForSelfEvolutionActivation\(\)/)
})

test('linked projects expose owning windows and can bring an existing owner forward', async () => {
  const [source, preload] = await Promise.all([
    readFile(new URL('./ipc.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
  ])

  const projectsStart = source.indexOf("ipcMain.handle('wharness:windows:projects'")
  const focusStart = source.indexOf("ipcMain.handle('wharness:windows:focus-project'")
  const openStart = source.indexOf("ipcMain.handle('wharness:windows:open'", focusStart)
  assert.notEqual(projectsStart, -1)
  assert.notEqual(focusStart, -1)
  const projectsHandler = source.slice(projectsStart, focusStart)
  const focusHandler = source.slice(focusStart, openStart)
  assert.match(projectsHandler, /for \(const state of desktopWindows\.values\(\)\)/)
  assert.match(projectsHandler, /currentWindowId: current\.id/)
  assert.match(focusHandler, /canonicalProjectPath\(request\?\.projectPath\)/)
  assert.match(focusHandler, /sendToWindowState\(owner, 'wharness:windows:activate-project', \{ projectPath \}\)/)
  assert.match(focusHandler, /owner\.window\.show\(\); owner\.window\.focus\(\)/)
  assert.match(preload, /projects: \(\) => invoke\('wharness:windows:projects'\)/)
  assert.match(preload, /focusProject: \(projectPath\) => invoke\('wharness:windows:focus-project'/)
  assert.match(preload, /wharness:windows:activate-project/)
})

test('project home IPC can pick logos, move closed projects to trash and open a project in a new window', async () => {
  const [source, preload] = await Promise.all([
    readFile(new URL('./ipc.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
  ])
  assert.match(source, /ipcMain\.handle\('wharness:projects:pick-image'/)
  assert.match(source, /filters: \[\{ name: 'Imagens', extensions: \['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'\] \}\]/)
  assert.match(source, /ipcMain\.handle\('wharness:projects:trash'/)
  assert.match(source, /await shell\.trashItem\(projectPath\)/)
  const openStart = source.indexOf("ipcMain.handle('wharness:windows:open'")
  const openEnd = source.indexOf("ipcMain.handle('wharness:windows:open-surface'", openStart)
  const openHandler = source.slice(openStart, openEnd)
  assert.match(openHandler, /canonicalProjectPath\(request\.projectPath\)/)
  assert.match(openHandler, /recovery: \{ projects: \[requestedProject\], activeProject: requestedProject, pending: false \}/)
  assert.match(preload, /pickImage: \(request = \{\}\) => invoke\('wharness:projects:pick-image', request\)/)
  assert.match(preload, /trash: \(projectPath\) => invoke\('wharness:projects:trash'/)
  assert.match(preload, /open: \(request = \{\}\) => invoke\('wharness:windows:open', request\)/)
})

test('closing or switching the active project hides Supervisor and interactive Worker surfaces in Desktop before renderer teardown', async () => {
  const [source, windowRuntime, windowIPC, ownership] = await Promise.all([
    readFile(new URL('../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../composition/window/runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./ipc.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./ownership.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(source, /hideAgentInteractionsForWindow: \(\.\.\.args\) => hideChatAgentInteractionsForWindow\(\.\.\.args\)/)
  assert.match(windowRuntime, /createProjectWindowOwnership\(\{[\s\S]*hideAgentInteractions: d\.hideAgentInteractionsForWindow/)
  const suspendStart = ownership.indexOf('function suspendNativeSurfacesForWindow(windowState)')
  const suspendEnd = ownership.indexOf('\n  function acquireProjectForWindow', suspendStart)
  const suspend = ownership.slice(suspendStart, suspendEnd)
  assert.ok(suspendStart >= 0)
  assert.match(suspend, /windowState\.chatgptVisible = false/)
  assert.match(suspend, /active\.view\.setVisible\(false\)/)
  assert.match(suspend, /hideAgentInteractions\(windowState\)/)

  const releaseStart = ownership.indexOf('function releaseProjectForWindow(windowState, value)')
  const releaseEnd = ownership.indexOf('\n  function releaseWindowProjects', releaseStart)
  assert.match(ownership.slice(releaseStart, releaseEnd), /activeProject === requested\) suspendNativeSurfacesForWindow\(windowState\)/)

  const activateStart = windowIPC.indexOf("ipcMain.handle('wharness:projects:activate'")
  const activateEnd = windowIPC.indexOf("ipcMain.handle('wharness:projects:bindings'", activateStart)
  assert.match(windowIPC.slice(activateStart, activateEnd), /activeProject !== projectPath\) suspendNativeSurfacesForWindow\(windowState\)/)
})

test('detached workbench surfaces stay transient and keep project ownership with the parent window', async () => {
  const [source, windowIPC] = await Promise.all([
    readFile(new URL('../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./ipc.mjs', import.meta.url), 'utf8'),
  ])
  const createWindowSource = await readFile(new URL('../lifecycle/create/window.mjs', import.meta.url), 'utf8')
  assert.match(source, /createDesktopEntrypointRuntime\(\{/)
  assert.match(await readFile(new URL('../../composition/window/creation-runtime.mjs', import.meta.url), 'utf8'), /const createWindow = createDesktopWindowCreator\(\{/)
  assert.match(createWindowSource, /transientSurface: Boolean\(surface\)/)
  assert.match(createWindowSource, /if \(surface\?\.projectPath\) \{[\s\S]*state\.projects\.add\(surface\.projectPath\)/)
  assert.match(createWindowSource, /if \(!state\.transientSurface\) \{[\s\S]*win\.on\('resize', scheduleWindowLayoutPersistence\)/)
  assert.match(createWindowSource, /if \(!isQuitting\(\) && !state\.transientSurface\) persistWindowLayout\(\)/)
  assert.match(source, /isQuitting: \(\) => quitting/)
  const layoutSource = await readFile(new URL('../layout/layout.mjs', import.meta.url), 'utf8')
  assert.match(layoutSource, /function persist\(ids = \[\.\.\.windows\.values\(\)\]\.filter\(\(state\) => !state\.window\.isDestroyed\(\) && !state\.transientSurface\)/)
  assert.match(windowIPC, /find\(\(state\) => !state\.window\.isDestroyed\(\) && !state\.transientSurface && state\.projects\.has\(projectPath\)\)/)

  const handlerStart = windowIPC.indexOf("ipcMain.handle('wharness:windows:open-surface'")
  assert.notEqual(handlerStart, -1)
  const handler = windowIPC.slice(handlerStart, windowIPC.indexOf("ipcMain.handle('wharness:windows:minimize'", handlerStart))
  assert.match(handler, /owner\.projects\.has\(surface\.projectPath\)/)
  assert.match(handler, /createWindow\(`surface-\$\{randomUUID\(\)\}`, false, \{ surface \}\)/)
  assert.match(handler, /wharness:windows:move-surface/)
  assert.match(handler, /destination\.activeProject !== surface\.projectPath/)
  assert.match(handler, /wharness:windows:receive-surface/)
  assert.match(handler, /reason: 'different-project'/)
  assert.doesNotMatch(handler, /projectWindowRegistry\.set/)
})
