import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('desktop close confirmation is renderer-owned while actions stay main-process authoritative', async () => {
  const [main, preload, shell] = await Promise.all([
    readFile(new URL('./main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/components/WorkspaceShell.tsx', import.meta.url), 'utf8'),
  ])
  const closeStart = main.indexOf('const desktopWindowClose = createDesktopWindowCloseCoordinator')
  const closeEnd = main.indexOf('\nfunction promptDesktopRecoverySession', closeStart)
  const closeFlow = main.slice(closeStart, closeEnd)

  assert.ok(closeStart >= 0)
  assert.match(closeFlow, /wharness:windows:confirm-close/)
  assert.doesNotMatch(closeFlow, /showMessageBoxSync/)
  assert.match(main, /ipcMain\.handle\('wharness:windows:resolve-close'/)
  assert.match(preload, /ipcRenderer\.on\('wharness:windows:confirm-close', handler\)/)
  assert.match(preload, /resolveClose: \(action\) => invoke\('wharness:windows:resolve-close'/)
  assert.match(shell, /<DesktopCloseDialogHost \/>/)
})
