import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8')
const shellIPC = await readFile(new URL('../window/control/ipc.mjs', import.meta.url), 'utf8')
const preload = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8')
const tray = await readFile(new URL('../tray/desktop-tray-control.mjs', import.meta.url), 'utf8')

test('completion notifications are deduplicated and exposed through the tray controller', () => {
  assert.match(main, /createDesktopTrayControl/)
  assert.match(main, /registerDesktopShellIPC\(\{/)
  assert.match(shellIPC, /ipcMain\.handle\('wharness:notifications:publish'/)
  assert.match(tray, /notifications\.has\(record\.id\)/)
  assert.match(tray, /label: `Notificações\$\{unread/)
  assert.match(tray, /find\(\(record\) => !record\.read\)/)
  assert.match(main, /'wharness:notifications:open'/)
})

test('preload exposes notification and tray actions without renderer Node access', () => {
  assert.match(preload, /notifications: Object\.freeze\(\{/)
  assert.match(preload, /invoke\('wharness:notifications:publish'/)
  assert.match(preload, /tray: Object\.freeze\(\{/)
  assert.match(preload, /invoke\('wharness:tray:update-project-state'/)
  assert.match(preload, /ipcRenderer\.on\('wharness:tray:action'/)
})
