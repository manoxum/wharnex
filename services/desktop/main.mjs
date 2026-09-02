import { app, BrowserWindow, ClipboardItem, WebContentsView, clipboard, ipcMain, session, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { contextBundleURL, externalAuthProvider, isHTTPS, normalizeBounds, requireLocalHTTPURL, sanitizeSessionId } from './security.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_URL = requireLocalHTTPURL(process.env.WHARNESS_FRONTEND_URL || 'http://127.0.0.1:5173', 'Frontend URL').href
const BACKEND_URL = requireLocalHTTPURL(process.env.WHARNESS_API_URL || 'http://127.0.0.1:8080', 'Backend URL').href
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
const CHATGPT_URL = 'https://chatgpt.com/'
const CHATGPT_PARTITION = 'persist:wharness-chatgpt'
const MAX_CONTEXT_BYTES = 256 * 1024 * 1024

let mainWindow
let chatgptView
let chatgptVisible = false
let chatgptLoading = true

function securePreferences(extra = {}) {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    ...extra,
  }
}

function trustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted IPC sender')
}

function setChatGPTBounds(value) {
  const bounds = normalizeBounds(value, mainWindow?.getContentBounds())
  if (!bounds || !chatgptView) return false
  chatgptView.setBounds(bounds)
  return true
}

function currentChatGPTState() {
  const wc = chatgptView?.webContents
  return {
    url: wc?.getURL() || CHATGPT_URL,
    title: wc?.getTitle() || 'ChatGPT',
    loading: chatgptLoading,
    canGoBack: Boolean(wc?.navigationHistory.canGoBack()),
    canGoForward: Boolean(wc?.navigationHistory.canGoForward()),
  }
}

function publishChatGPTState() {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('wharness:chatgpt:state', currentChatGPTState())
}

function createChatGPTView() {
  chatgptView = new WebContentsView({
    webPreferences: securePreferences({ partition: CHATGPT_PARTITION }),
  })
  chatgptView.setBackgroundColor('#ffffff')

  const wc = chatgptView.webContents
  wc.setWindowOpenHandler(({ url }) => {
    if (!isHTTPS(url)) return { action: 'deny' }
    const provider = externalAuthProvider(url)
    if (provider) {
      void shell.openExternal(url)
      if (!mainWindow?.isDestroyed()) {
        mainWindow.webContents.send('wharness:chatgpt:external-auth', { provider, url })
      }
      return { action: 'deny' }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => { if (!isHTTPS(url)) event.preventDefault() })
  wc.on('did-start-loading', () => { chatgptLoading = true; publishChatGPTState() })
  wc.on('did-stop-loading', () => { chatgptLoading = false; publishChatGPTState() })
  wc.on('did-navigate', publishChatGPTState)
  wc.on('did-navigate-in-page', publishChatGPTState)
  wc.on('page-title-updated', publishChatGPTState)
  void wc.loadURL(CHATGPT_URL)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'Wharness Desktop',
    name: 'wharness-main',
    windowStatePersistence: true,
    backgroundColor: '#eceee7',
    autoHideMenuBar: true,
    webPreferences: securePreferences({ preload: path.join(here, 'preload.cjs') }),
  })

  createChatGPTView()
  mainWindow.contentView.addChildView(chatgptView)
  chatgptView.setVisible(false)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHTTPS(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== FRONTEND_ORIGIN) event.preventDefault() }
    catch { event.preventDefault() }
  })
  mainWindow.on('blur', publishChatGPTState)
  mainWindow.on('closed', () => {
    if (chatgptView && !chatgptView.webContents.isDestroyed()) chatgptView.webContents.close()
    chatgptView = undefined
    mainWindow = undefined
  })

  void mainWindow.loadURL(FRONTEND_URL)
}

function registerIPC() {
  ipcMain.handle('wharness:chatgpt:show', (event, bounds) => {
    trustedSender(event)
    chatgptVisible = true
    setChatGPTBounds(bounds)
    chatgptView?.setVisible(true)
    publishChatGPTState()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:hide', (event) => {
    trustedSender(event)
    chatgptVisible = false
    chatgptView?.setVisible(false)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:set-bounds', (event, bounds) => {
    trustedSender(event)
    return { ok: chatgptVisible ? setChatGPTBounds(bounds) : false }
  })
  ipcMain.handle('wharness:chatgpt:reload', (event) => { trustedSender(event); chatgptView?.webContents.reload(); return { ok: true } })
  ipcMain.handle('wharness:chatgpt:focus', (event) => { trustedSender(event); chatgptView?.webContents.focus(); return { ok: true } })
  ipcMain.handle('wharness:chatgpt:back', (event) => {
    trustedSender(event)
    if (chatgptView?.webContents.navigationHistory.canGoBack()) chatgptView.webContents.navigationHistory.goBack()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:forward', (event) => {
    trustedSender(event)
    if (chatgptView?.webContents.navigationHistory.canGoForward()) chatgptView.webContents.navigationHistory.goForward()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:state', (event) => { trustedSender(event); return currentChatGPTState() })
  ipcMain.handle('wharness:chatgpt:open-external', async (event) => {
    trustedSender(event)
    await shell.openExternal(CHATGPT_URL)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:paste', (event) => { trustedSender(event); chatgptView?.webContents.paste(); return { ok: true } })
  ipcMain.handle('wharness:clipboard:read-text', (event) => { trustedSender(event); return clipboard.readText() })
  ipcMain.handle('wharness:clipboard:write-text', async (event, value) => {
    trustedSender(event)
    const text = String(value || '')
    if (text.length > 4 * 1024 * 1024) throw new Error('Clipboard text exceeds 4 MiB limit')
    await clipboard.writeText(text)
    return { ok: true }
  })
  ipcMain.handle('wharness:clipboard:copy-context-zip', async (event, request) => {
    trustedSender(event)
    const sessionId = sanitizeSessionId(request?.sessionId)
    const response = await fetch(contextBundleURL(BACKEND_URL, sessionId), { redirect: 'error' })
    if (!response.ok) throw new Error(`Context bundle HTTP ${response.status}`)
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop clipboard limit')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop clipboard limit')
    if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Backend did not return a ZIP bundle')

    const dir = path.join(app.getPath('temp'), 'wharness-context', sessionId)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `wharness-context-${sessionId}.zip`)
    await writeFile(filePath, bytes, { mode: 0o600 })
    await clipboard.write([new ClipboardItem({ 'text/uri-list': `${pathToFileURL(filePath).href}\r\n` })])
    return { ok: true, bytes: bytes.byteLength }
  })
}

app.whenReady().then(() => {
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  chatSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'notifications'))
  chatSession.setPermissionCheckHandler((_webContents, permission) => permission === 'notifications')
  registerIPC()
  createWindow()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
