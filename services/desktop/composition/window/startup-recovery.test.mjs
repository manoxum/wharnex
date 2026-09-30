import { readDesktopIPCSource } from '../ipc/source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('workspace toolbar owns the themed title bar and window controls', async () => {
  const create = await readFile(new URL('../../window/lifecycle/create/window.mjs', import.meta.url), 'utf8')
  assert.match(create, /frame: false/)
  assert.doesNotMatch(create, /titleBarOverlay/)
})


test('desktop tray resolves the installed Wharnex raster icon before SVG fallback', async () => {
  const source = await readDesktopIPCSource()
  const resolveStart = source.indexOf('function resolveDesktopIcon()')
  const resolveEnd = source.indexOf('\nconst DESKTOP_ICON = resolveDesktopIcon()', resolveStart)
  const resolve = source.slice(resolveStart, resolveEnd)
  const png = resolve.indexOf("'256x256'")
  const svg = resolve.indexOf("'scalable'")
  const fallback = resolve.indexOf('nativeImage.createFromDataURL')

  assert.ok(resolveStart !== -1 && resolveEnd > resolveStart)
  assert.match(resolve, /WHARNESS_DESKTOP_DATA_HOME/)
  assert.match(resolve, /nativeImage\.createFromPath\(candidate\)/)
  assert.match(resolve, /if \(!image\.isEmpty\(\)\) return image/)
  assert.ok(png !== -1 && svg > png && fallback > svg)
  assert.match(source, /const DESKTOP_ICON = resolveDesktopIcon\(\)/)
})

test('Linux Desktop uses software compositing to avoid GPU renderer traps', async () => {
  const source = await readFile(new URL('../../lifecycle/startup/desktop-process.mjs', import.meta.url), 'utf8')
  assert.match(source, /if \(platform === 'linux'\) app\.disableHardwareAcceleration\(\)/)
})

test('local frontend navigation uses a per-runtime cache token', async () => {
  const source = await readDesktopIPCSource()
  assert.match(source, /const FRONTEND_RUNTIME_TOKEN = randomUUID\(\)/)
  assert.match(source, /createDesktopWindowCreator\(\{[\s\S]*FRONTEND_URL, FRONTEND_RUNTIME_TOKEN, FRONTEND_ORIGIN/)
  const create = await readFile(new URL('../../window/lifecycle/create/window.mjs', import.meta.url), 'utf8')
  assert.match(create, /target\.searchParams\.set\('wharnessRuntime', FRONTEND_RUNTIME_TOKEN\)/)
})

test('desktop disables a broken IPv6 browser route before Electron becomes ready', async () => {
  const main = await readDesktopIPCSource()
  const bootstrap = await readFile(new URL('../../lifecycle/startup/desktop-process.mjs', import.meta.url), 'utf8')
  const configureAt = main.indexOf('configureDesktopProcess({')
  const readyAt = main.indexOf('app.whenReady()')
  assert.match(bootstrap, /app\.commandLine\.appendSwitch\('disable-ipv6'\)/)
  assert.ok(configureAt >= 0 && configureAt < readyAt)
})

test('renderer navigation preserves overlay-driven ChatGPT visibility', async () => {
  const source = await readFile(new URL('../../chatgpt/session/ipc/navigation.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("ipcMain.handle('wharness:chatgpt:navigate'")
  const end = source.indexOf("ipcMain.handle('wharness:chatgpt:confirm-affinity'", start)
  const navigate = source.slice(start, end)
  assert.doesNotMatch(navigate, /windowState\.chatgptVisible = true/)
  assert.match(navigate, /activateChatGPTView\(key, request\?\.bounds, windowState\)/)
})

test('an uncaught main-process exception or rejection is logged instead of silently crashing the whole app', async () => {
  const source = await readFile(new URL('../../lifecycle/startup/desktop-process.mjs', import.meta.url), 'utf8')
  assert.match(source, /processTarget\.on\('uncaughtException', \(error\) => \{\s*logger\.error\('\[main-process-fault\] uncaughtException', error\)/)
  assert.match(source, /processTarget\.on\('unhandledRejection', \(reason\) => \{\s*logger\.error\('\[main-process-fault\] unhandledRejection', reason\)/)
})

test('a second launch against the same userData profile hands off to the running instance instead of running two Chromium profiles at once', async () => {
  const source = await readFile(new URL('../../lifecycle/startup/desktop-process.mjs', import.meta.url), 'utf8')
  const main = await readDesktopIPCSource()
  const lockStart = source.indexOf('const customUserDataDir =')
  const lockEnd = source.length
  assert.notEqual(lockStart, -1)
  const lockBlock = source.slice(lockStart, lockEnd)
  assert.match(lockBlock, /if \(!path\.isAbsolute\(customUserDataDir\)\) throw new Error\('WHARNESS_DESKTOP_USER_DATA_DIR must be an absolute path'\)/)
  assert.match(lockBlock, /app\.setPath\('userData', path\.normalize\(customUserDataDir\)\)/)
  assert.match(lockBlock, /if \(!app\.requestSingleInstanceLock\(\)\) \{\s*app\.quit\(\)/)
  assert.match(lockBlock, /app\.on\('second-instance', \(\) => \{/)
  assert.match(main, /configureDesktopProcess\(\{[\s\S]*getMainWindow: \(\) => mainWindow/)
})

test('a dead main-frame renderer in the trusted window reloads the frontend instead of leaving a permanently blank window', async () => {
  const create = await readFile(new URL('../../window/lifecycle/create/window.mjs', import.meta.url), 'utf8')
  const createStart = create.indexOf('function createWindow(')
  assert.notEqual(createStart, -1)
  const targetIndex = create.indexOf("target.searchParams.set('wharnessRuntime', FRONTEND_RUNTIME_TOKEN)")
  const renderProcessGoneIndex = create.indexOf("win.webContents.on('render-process-gone'")
  assert.notEqual(targetIndex, -1)
  assert.notEqual(renderProcessGoneIndex, -1)
  assert.ok(targetIndex < renderProcessGoneIndex, 'target URL must be built before the crash handler closes over it')
  // The window must still come back — the reload is now paced and bounded
  // rather than immediate (see the backoff regression below), but a crashed
  // renderer must never be left as a permanently blank window.
  assert.match(create, /void win\.loadURL\(target\.href\)/)
  assert.match(create, /render-process-gone[\s\S]{0,900}?state\.rendererRestartTimer = setTimeout\(/)
})

// Account automation gives a background chat surface a real, full-size layout
// viewport so its renderer lays out and accepts trusted input — Electron clips
// a child view to its parent, so off-screen bounds collapse it to 0x0 and it
// stops receiving input entirely. Those bounds must therefore never be on
// screen: showing such a view before the renderer reports its real pane
// geometry covers the whole Wharnex window for a frame, which reads as the
// project closing and reopening.
test('a parked chat surface is never shown while it carries layout-only bounds', async () => {
  const source = await readDesktopIPCSource()
  const surface = await readFile(new URL('../../agent/supervision/surface/visibility.mjs', import.meta.url), 'utf8')
  const viewportSource = await readFile(new URL('../../chatgpt/account/control/viewport.mjs', import.meta.url), 'utf8')
  const authIPC = await readFile(new URL('../../chatgpt/session/ipc/authentication.mjs', import.meta.url), 'utf8')
  const modeIPC = await readFile(new URL('../../chatgpt/session/ipc/modes.mjs', import.meta.url), 'utf8')
  assert.match(source, /registerChatGPTSessionControlIPC\(\{/)

  const parkStart = viewportSource.indexOf('function ensureChatGPTLayoutViewport(')
  const park = viewportSource.slice(parkStart)
  assert.match(park, /entry\.parkedLayout = true/)
  assert.doesNotMatch(park, /x: -\d+/)

  assert.match(source, /createSupervisorSurfaceVisibility\(\{[\s\S]*chatgptViews, sanitizeChatCacheKey/)
  const predicateStart = surface.indexOf('function chatGPTSurfaceShouldBeVisible(')
  const predicate = surface.slice(predicateStart, surface.indexOf('\n  function activateChatGPTView(', predicateStart))
  assert.match(predicate, /const parked = entry\.parkedLayout === true && !ownerState\.chatgptBounds/)
  assert.match(predicate, /Boolean\(ownerState\.chatgptVisible\) && !entry\.externalAuthProvider && !parked/)

  // Every path that makes an owned surface visible must share the predicate, or
  // a parked view slips through the one that does not - which is reachable now
  // that a slot carries layout bounds from the moment it is created.
  //
  // showChatAgentInteraction is the one legitimate exception: it is the Worker
  // interaction surface, not the Supervisor one, and it assigns real pane bounds
  // and clears parkedLayout on the line above the show.
  const interactionStart = source.indexOf('function showChatAgentInteraction(')
  const interactionEnd = source.indexOf('\nfunction ', interactionStart + 1)
  let shows = 0
  const showSources = `${source}\n${surface}\n${authIPC}\n${modeIPC}`
  for (const match of showSources.matchAll(/entry\.view\.setVisible\(([^)]*)\)/g)) {
    const [, argument] = match
    if (argument === 'false') continue
    shows += 1
    if (match.index > interactionStart && match.index < interactionEnd) {
      assert.match(source.slice(interactionStart, interactionEnd), /entry\.parkedLayout = false\n\s*entry\.view\.setVisible\(true\)/)
      continue
    }
    assert.ok(
      argument.startsWith('chatGPTSurfaceShouldBeVisible('),
      `entry.view.setVisible(${argument}) bypasses the parked-surface predicate`,
    )
  }
  assert.ok(shows >= 4, 'expected the supervisor show paths to be covered')

  // Real pane bounds clear the parked flag, so the view becomes showable again.
  const viewState = await readFile(new URL('../../chatgpt/session/views/state.mjs', import.meta.url), 'utf8')
  const boundsStart = viewState.indexOf('function setChatGPTBounds(')
  const boundsEnd = viewState.indexOf('\n  function currentChatGPTState(', boundsStart)
  assert.match(source, /createChatGPTViewState\(\{/)
  assert.match(viewState.slice(boundsStart, boundsEnd), /entry\.parkedLayout = false/)
})

// Reloading the instant a renderer dies can re-enter the same failure: a
// loadURL issued while a previous sandboxed renderer spawn is still settling is
// one of the ways Electron produces "Cannot destructure property
// 'preloadScripts' of 'binding.startupData'", so an immediate retry can turn a
// single crash into a reload loop.
test('frontend renderer crash recovery backs off and is bounded', async () => {
  const source = await readFile(new URL('../../window/lifecycle/create/window.mjs', import.meta.url), 'utf8')
  const main = await readDesktopIPCSource()
  const start = source.indexOf("win.webContents.on('render-process-gone'")
  const end = source.indexOf("win.webContents.on('unresponsive'", start)
  assert.notEqual(start, -1)
  const handler = source.slice(start, end)

  assert.match(handler, /state\.rendererRestarts >= FRONTEND_RENDERER_RESTART_LIMIT/)
  assert.match(handler, /Math\.min\(8_000, 500 \* \(2 \*\* \(state\.rendererRestarts - 1\)\)\)/)
  assert.match(handler, /setTimeout\(/)
  // The reload must not be issued synchronously from the crash event.
  const immediate = handler.indexOf('win.loadURL')
  const scheduled = handler.indexOf('state.rendererRestartTimer = setTimeout(')
  assert.ok(scheduled !== -1 && scheduled < immediate, 'reload must be scheduled, not immediate')
  assert.match(handler, /if \(isQuitting\(\) \|\| details\.reason === 'clean-exit'\) return/)
  assert.match(main, /getMainWindow: \(\) => mainWindow, isQuitting: \(\) => quitting/)

  // A renderer that stays up long enough clears the budget.
  assert.match(source, /state\.rendererRestarts = 0/)
})
