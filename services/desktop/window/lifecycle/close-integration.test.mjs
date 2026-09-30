import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('desktop close confirmation is renderer-owned while actions stay main-process authoritative', async () => {
  const [main, closeFlow, windowIPC, preload, shell, host, coordinator] = await Promise.all([
    readFile(new URL('../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../composition/window/tray-lifecycle.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../project/ipc.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../../../frontend/src/components/workspace/shell/WorkspaceShell.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../../frontend/src/components/workspace/window/DesktopCloseDialogHost.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./desktop-window-close.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(main, /desktopWindowClose,\s*\}\s*= createDesktopTrayComposition\(/)
  assert.match(closeFlow, /const desktopWindowClose = createDesktopWindowCloseCoordinator\(/)
  assert.match(closeFlow, /wharness:windows:confirm-close/)
  assert.doesNotMatch(closeFlow, /showMessageBoxSync/)
  assert.match(windowIPC, /ipcMain\.handle\('wharness:windows:resolve-close'/)
  assert.match(coordinator, /if \(action === 'close-window'\) closeWindow\(windowState\)/)
  assert.doesNotMatch(coordinator, /CLOSE_ACTIONS[^\n]*close-project/)
  assert.match(closeFlow, /closeWindow: \(windowState\) => windowState\.window\.destroy\(\)/)
  assert.doesNotMatch(closeFlow, /closeProject:/)
  assert.match(preload, /ipcRenderer\.on\('wharness:windows:confirm-close', handler\)/)
  assert.match(preload, /resolveClose: \(action\) => invoke\('wharness:windows:resolve-close'/)
  assert.match(shell, /<DesktopCloseDialogHost terminals=\{terminalProcesses \|\| \[\]\} \/>/)

  // The native prompt is a fallback for a renderer that never showed the
  // modal. The modal must therefore say that it did, end to end, or the two
  // prompts appear stacked on top of each other.
  assert.match(windowIPC, /ipcMain\.handle\('wharness:windows:acknowledge-close'/)
  assert.match(preload, /acknowledgeClose: \(\) => invoke\('wharness:windows:acknowledge-close'\)/)
  assert.match(host, /windows\.acknowledgeClose\?\.\(\)/)
})
