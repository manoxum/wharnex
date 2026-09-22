import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')

test('completion notifications are deduplicated and exposed through the tray', () => {
  assert.match(main, /const desktopNotifications = new Map\(\)/)
  assert.match(main, /ipcMain\.handle\('wharness:notifications:publish'/)
  assert.match(main, /label: `Notificações\$\{unread/)
  assert.match(main, /find\(\(record\) => !record\.read\)/)
  assert.match(main, /sendToWindowState\(state, 'wharness:notifications:open'/)
})

test('preload exposes publish and open events without renderer Node access', () => {
  assert.match(preload, /notifications: Object\.freeze\(\{/)
  assert.match(preload, /invoke\('wharness:notifications:publish'/)
  assert.match(preload, /ipcRenderer\.on\('wharness:notifications:open'/)
})
