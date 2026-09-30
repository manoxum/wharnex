import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Portuguese spell checking is configured from Chromium dictionaries', async () => {
  const source = await readFile(new URL('../../chatgpt/session/session-setup.mjs', import.meta.url), 'utf8')
  assert.match(source, /availableSpellCheckerLanguages/)
  assert.match(source, /'pt-PT', 'pt-BR', 'en-US'/)
  assert.match(source, /setSpellCheckerLanguages/)
})


test('local editable fields wire native spelling corrections into the Electron menu', async () => {
  const source = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const menu = await readFile(new URL('../../window/lifecycle/create/editor-menu.mjs', import.meta.url), 'utf8')
  const createWindow = await readFile(new URL('../../window/lifecycle/create/window.mjs', import.meta.url), 'utf8')
  assert.match(source, /createDesktopWindowCreator\(\{[\s\S]*spellcheckContextMenuTemplate/)
  assert.match(createWindow, /installLocalEditorContextMenu\(win, \{ Menu, spellcheckContextMenuTemplate \}\)/)
  assert.match(menu, /webContents\.on\('context-menu'/)
  assert.match(menu, /spellcheckContextMenuTemplate/)
  assert.match(menu, /replaceMisspelling/)
  assert.match(menu, /addWordToSpellCheckerDictionary/)
  assert.match(menu, /Menu\.buildFromTemplate/)
})

test('Ctrl+Space can reopen native spelling suggestions at the composer caret', async () => {
  const [source, handlerSource, preload, menu] = await Promise.all([
    readFile(new URL('../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../window/interaction/spellcheck-ipc.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../../window/lifecycle/create/editor-menu.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(source, /registerSpellcheckIPC\(\{ ipcMain, trustedSender \}\)/)
  const handlerStart = handlerSource.indexOf("ipcMain.handle('wharness:spellcheck:show-suggestions'")
  const handler = handlerSource.slice(handlerStart)
  assert.notEqual(handlerStart, -1)
  assert.match(handler, /trustedSender\(event\)/)
  assert.match(handler, /windowState\.window\.focus\(\)/)
  assert.match(handler, /const debuggerAttachedHere = !input\.debugger\.isAttached\(\)/)
  assert.match(handler, /input\.debugger\.attach\('1\.3'\)/)
  assert.match(handler, /sendCommand\('Input\.dispatchMouseEvent', \{ type: 'mouseMoved', x, y \}\)/)
  assert.match(handler, /sendCommand\('Input\.dispatchMouseEvent', \{ type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 \}\)/)
  assert.match(handler, /sendCommand\('Input\.dispatchMouseEvent', \{ type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 \}\)/)
  assert.match(handler, /input\.debugger\.detach\(\)/)
  assert.doesNotMatch(handler, /\.sendInputEvent\(/)
  assert.match(source, /createDesktopWindowCreator\(\{/)
  assert.match(menu, /Menu\.buildFromTemplate\(template\)\.popup\(\{ window: win, x: params\.x, y: params\.y \}\)/)
  assert.match(preload, /spellcheck: Object\.freeze\(\{[\s\S]*showSuggestions: \(point = \{\}\) => invoke\('wharness:spellcheck:show-suggestions'/)
})
