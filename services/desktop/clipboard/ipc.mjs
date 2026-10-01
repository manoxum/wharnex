import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_CLIPBOARD_TEXT_BYTES = 4 * 1024 * 1024

export function registerClipboardIPC({ ipcMain, trustedSender, clipboard, ClipboardItem, app, fetchContextZip }) {
  ipcMain.handle('wharness:clipboard:read-text', (event) => {
    trustedSender(event)
    return clipboard.readText()
  })
  ipcMain.handle('wharness:clipboard:write-text', async (event, value) => {
    trustedSender(event)
    const text = String(value || '')
    if (text.length > MAX_CLIPBOARD_TEXT_BYTES) throw new Error('Clipboard text exceeds 4 MiB limit')
    await clipboard.writeText(text)
    return { ok: true }
  })
  ipcMain.handle('wharness:clipboard:copy-context-zip', async (event, request) => {
    trustedSender(event)
    const { id: sessionId, bytes } = await fetchContextZip(request?.sessionId)
    const dir = path.join(app.getPath('temp'), 'wharness-context', sessionId)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `wharness-context-${sessionId}.zip`)
    await writeFile(filePath, bytes, { mode: 0o600 })
    await clipboard.write([new ClipboardItem({ 'text/uri-list': `${pathToFileURL(filePath).href}\r\n` })])
    return { ok: true, bytes: bytes.byteLength }
  })
}
