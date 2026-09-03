import { app, BrowserWindow, ClipboardItem, WebContentsView, clipboard, dialog, ipcMain, nativeImage, session, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ChatGPTSubmitCoordinator, dispatchChatGPTSubmit } from './chatgpt-input.mjs'
import { ChatGPTUploadCoordinator, pasteWithUploadRetry, plannerPromptMarkdown, waitForChatGPTReady } from './chatgpt-upload.mjs'
import { persistChatAttachmentFiles, readStoredAttachmentPreview, removeStoredChatAttachments, storedAttachmentPath } from './chat-attachment-store.mjs'
import { chatGPTExpectedDownloadScript, chatGPTFillComposerScript, chatGPTFocusComposerScript, chatGPTSubmitScript } from './chatgpt-dom.mjs'
import { pathSize, restoreBrowserSession, snapshotBrowserSession } from './browser-session-data.mjs'
import { chatGPTNavigationDisposition, chatInputSettleDelay, chromeCompatibleUserAgent, contextBundleURL, decodeUserAttachment, isHTTPS, isTrustedChatGPTOrigin, normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, sanitizeChatCacheKey, sanitizeDiagnosticURL, sanitizeSessionId, canonicalWharnessBundleDownload, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename } from './security.mjs'
import { shouldAttachProjectContext } from './chatgpt-context.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_URL = requireLocalHTTPURL(process.env.WHARNESS_FRONTEND_URL || 'http://127.0.0.1:5173', 'Frontend URL').href
const BACKEND_URL = requireLocalHTTPURL(process.env.WHARNESS_API_URL || 'http://127.0.0.1:8080', 'Backend URL').href
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
const CHATGPT_URL = 'https://chatgpt.com/'
const CHATGPT_PARTITION = 'persist:wharness-chatgpt'
const MAX_CONTEXT_BYTES = 256 * 1024 * 1024
const MAX_PLAN_BYTES = 2 * 1024 * 1024
const MAX_EXECUTION_BUNDLE_BYTES = 16 * 1024 * 1024
const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_CHAT_ATTACHMENTS_BYTES = 100 * 1024 * 1024
const MAX_CHAT_ATTACHMENTS = 10
const CHATGPT_CHROMIUM_VERSION = '152.0.7977.65'
const CHATGPT_USER_AGENT = chromeCompatibleUserAgent(process.platform, CHATGPT_CHROMIUM_VERSION)
const CHATGPT_ACCEPT_LANGUAGES = 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7'
const MAX_CHATGPT_VIEWS = 20
const SAFE_ATTACHMENT_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])
const MAX_ATTACHMENT_THUMBNAIL_SOURCE_BYTES = 8 * 1024 * 1024

let mainWindow
let chatgptViews = new Map()
let activeChatGPTKey = ''
let chatgptVisible = false
let chatgptBounds
const preparedChatGPTDrafts = new Map()
const expectedChatGPTBundles = new Map()
const EXPECTED_BUNDLE_TTL_MS = 60 * 60 * 1000
const DOM_DOWNLOAD_POLL_MS = 2_000
const DOM_DOWNLOAD_RETRY_MS = 5_000
let chatGPTDownloadPoller
let recentExpectedDownload
const chatGPTUploads = new ChatGPTUploadCoordinator()
const chatGPTSubmissions = new ChatGPTSubmitCoordinator()

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

function activeChatGPTEntry() {
  return activeChatGPTKey ? chatgptViews.get(activeChatGPTKey) : undefined
}

function canonicalBundleFilename(requestId) {
  const id = String(requestId || '').trim()
  const filename = `wharness-bundle-${id}.zip`
  if (wharnessBundleRequestIdFromFilename(filename) !== id) throw new Error('Invalid Wharness request id for bundle transport')
  return filename
}

function armExpectedChatGPTBundle(cacheKey, requestId) {
  const key = sanitizeChatCacheKey(cacheKey)
  const filename = canonicalBundleFilename(requestId)
  expectedChatGPTBundles.set(key, { requestId: String(requestId), filename, armedAt: Date.now() })
  return filename
}

function expectedChatGPTBundleForDownload(sourceWebContents, sourceFilename = '') {
  const canonicalRequestId = wharnessBundleRequestIdFromFilename(path.basename(String(sourceFilename || '')))
  if (canonicalRequestId) {
    for (const [key, expected] of expectedChatGPTBundles) {
      if (expected.requestId === canonicalRequestId) return { key, ...expected }
    }
  }
  const sourceEntry = sourceWebContents && [...chatgptViews.entries()].find(([, candidate]) => candidate.view.webContents.id === sourceWebContents.id)
  if (sourceEntry) {
    const expected = expectedChatGPTBundles.get(sourceEntry[0])
    if (expected && Date.now() - expected.armedAt <= EXPECTED_BUNDLE_TTL_MS) return { key: sourceEntry[0], ...expected }
  }
  if (recentExpectedDownload && Date.now() - recentExpectedDownload.at <= 12_000) {
    const expected = expectedChatGPTBundles.get(recentExpectedDownload.key)
    if (expected?.requestId === recentExpectedDownload.requestId) return { key: recentExpectedDownload.key, ...expected }
  }
  return undefined
}

function chatGPTPartitionPath() {
  return path.join(app.getPath('userData'), 'Partitions', 'wharness-chatgpt')
}

function pendingBrowserImportPath() {
  return path.join(app.getPath('userData'), '.wharness-browser-session-import.whbs')
}

function closeAllChatGPTViews() {
  for (const entry of chatgptViews.values()) {
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }
  chatgptViews = new Map()
  activeChatGPTKey = ''
}

function touchChatGPTEntry(entry) {
  entry.lastUsed = Date.now()
}

function noteChatGPTNetworkActivity(details) {
  const webContentsId = details?.webContentsId
  const entry = [...chatgptViews.values()].find((candidate) => candidate.view.webContents.id === webContentsId)
  if (entry) entry.lastNetworkActivity = Date.now()
}

function evictChatGPTViews() {
  while (chatgptViews.size > MAX_CHATGPT_VIEWS) {
    const candidates = [...chatgptViews.entries()].filter(([key]) => key !== activeChatGPTKey).sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const victim = candidates[0]
    if (!victim) return
    const [key, entry] = victim
    chatgptViews.delete(key)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    console.log(`[chatgpt-cache] evicted key=${key}`)
  }
}

function setChatGPTBounds(value) {
  const bounds = normalizeBounds(value, mainWindow?.getContentBounds())
  const entry = activeChatGPTEntry()
  if (!bounds || !entry) return false
  chatgptBounds = bounds
  entry.view.setBounds(bounds)
  return true
}

function currentChatGPTState() {
  const entry = activeChatGPTEntry()
  const wc = entry?.view.webContents
  return {
    cacheKey: activeChatGPTKey,
    url: wc?.getURL() || CHATGPT_URL,
    title: wc?.getTitle() || 'ChatGPT',
    loading: entry?.loading ?? true,
    canGoBack: Boolean(wc?.navigationHistory.canGoBack()),
    canGoForward: Boolean(wc?.navigationHistory.canGoForward()),
    externalAuthProvider: entry?.externalAuthProvider || '',
  }
}

function publishChatGPTState(key = activeChatGPTKey) {
  if (key !== activeChatGPTKey || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('wharness:chatgpt:state', currentChatGPTState())
}

function publishPlanDownload(payload) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('wharness:chatgpt:plan-downloaded', payload)
}

function publishPlanDownloadError(message, filename = '') {
  console.error(`[chatgpt-plan-download] ${message}${filename ? ` file=${filename}` : ''}`)
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('wharness:chatgpt:plan-download-error', { message, filename })
}

function publishBundleDownload(payload) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('wharness:chatgpt:bundle-downloaded', payload)
}

function publishBundleDownloadError(message, filename = '') {
  console.error(`[chatgpt-bundle-download] ${message}${filename ? ` file=${filename}` : ''}`)
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('wharness:chatgpt:bundle-download-error', { message, filename })
}

function registerChatGPTPlanDownloads(chatSession) {
  chatSession.on('will-download', (_event, item, sourceWebContents) => {
    // This handler is registered on the dedicated persist:wharness-chatgpt
    // partition. A generated attachment can be served through an internal
    // download WebContents rather than the visible ChatGPT WebContentsView, so
    // do not require object identity here. The strict filename + JSON protocol
    // + request_id checks below remain the authority for plan interception.
    const sourceFilename = item.getFilename()
    const expectedBundle = expectedChatGPTBundleForDownload(sourceWebContents, sourceFilename)
    let bundleCandidate
    try {
      bundleCandidate = canonicalWharnessBundleDownload(sourceFilename, expectedBundle?.requestId || '', item.getMimeType?.() || '')
    } catch (error) {
      item.cancel()
      publishBundleDownloadError(error instanceof Error ? error.message : String(error), sourceFilename)
      return
    }
    if (bundleCandidate) {
      const filename = bundleCandidate.filename
      const bundleRequestId = bundleCandidate.requestId
      const sourceURL = sourceWebContents?.getURL?.() || ''
      if (bundleCandidate.normalized) {
        console.warn(`[chatgpt-bundle-download] normalized sourceFile=${sourceFilename} canonicalFile=${filename} request=${bundleRequestId}`)
      }
      console.log(`[chatgpt-bundle-download] started file=${filename} source=${sanitizeDiagnosticURL(sourceURL)}`)
      const total = item.getTotalBytes()
      if (total > MAX_EXECUTION_BUNDLE_BYTES) {
        item.cancel()
        publishBundleDownloadError('Bundle Wharness excede o limite de 16 MiB.', filename)
        return
      }
      const dir = path.join(app.getPath('temp'), 'wharness-bundles')
      const savePath = path.join(dir, filename)
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        item.setSavePath(savePath)
      } catch (error) {
        item.cancel()
        publishBundleDownloadError(`Não foi possível preparar o bundle: ${error instanceof Error ? error.message : String(error)}`, filename)
        return
      }
      item.on('updated', () => {
        if (item.getReceivedBytes() > MAX_EXECUTION_BUNDLE_BYTES) {
          item.cancel()
          publishBundleDownloadError('Bundle Wharness excede o limite de 16 MiB.', filename)
        }
      })
      item.once('done', async (_doneEvent, state) => {
        if (state !== 'completed') {
          if (state !== 'cancelled') publishBundleDownloadError(`Download do bundle terminou em estado ${state}.`, filename)
          return
        }
        try {
          const bytes = await readFile(savePath)
          if (bytes.byteLength > MAX_EXECUTION_BUNDLE_BYTES) throw new Error('Bundle Wharness excede o limite de 16 MiB.')
          const validated = validateWharnessBundleDownload(filename, bytes)
          publishBundleDownload({ filename, requestId: validated.requestId, contentBase64: bytes.toString('base64'), bytes: bytes.byteLength, sourceFilename, normalizedFilename: bundleCandidate.normalized })
          if (expectedBundle?.key && expectedBundle.requestId === validated.requestId) expectedChatGPTBundles.delete(expectedBundle.key)
          console.log(`[chatgpt-bundle-download] imported file=${filename} bytes=${bytes.byteLength}`)
        } catch (error) {
          publishBundleDownloadError(error instanceof Error ? error.message : String(error), filename)
        } finally {
          try { await rm(savePath, { force: true }) } catch { /* best effort temp cleanup */ }
        }
      })
      return
    }
    if (sourceFilename.startsWith('wharness-bundle-')) {
      item.cancel()
      publishBundleDownloadError('Nome do bundle inválido; esperado wharness-bundle-<request_id>.zip.', sourceFilename)
      return
    }

    const filename = sourceFilename
    const requestId = wharnessPlanRequestIdFromFilename(filename)
    if (!requestId) {
      if (filename.startsWith('wharness-plan-')) {
        item.cancel()
        publishPlanDownloadError('Nome do ficheiro de plano inválido; esperado wharness-plan-<request_id>.json.', filename)
      }
      return
    }
    const sourceURL = sourceWebContents?.getURL?.() || ''
    console.log(`[chatgpt-plan-download] started file=${filename} source=${sanitizeDiagnosticURL(sourceURL)}`)

    const total = item.getTotalBytes()
    if (total > MAX_PLAN_BYTES) {
      item.cancel()
      publishPlanDownloadError('Plano Wharness excede o limite de 2 MiB.', filename)
      return
    }

    const dir = path.join(app.getPath('temp'), 'wharness-plans')
    const savePath = path.join(dir, filename)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      item.setSavePath(savePath)
    } catch (error) {
      item.cancel()
      publishPlanDownloadError(`Não foi possível preparar o download: ${error instanceof Error ? error.message : String(error)}`, filename)
      return
    }

    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_PLAN_BYTES) {
        item.cancel()
        publishPlanDownloadError('Plano Wharness excede o limite de 2 MiB.', filename)
      }
    })

    item.once('done', async (_doneEvent, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') publishPlanDownloadError(`Download do plano terminou em estado ${state}.`, filename)
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > MAX_PLAN_BYTES) throw new Error('Plano Wharness excede o limite de 2 MiB.')
        const text = bytes.toString('utf8')
        const validated = validateWharnessPlanFile(filename, text)
        publishPlanDownload({ filename, requestId: validated.requestId, text: validated.text, bytes: bytes.byteLength })
        console.log(`[chatgpt-plan-download] imported file=${filename} bytes=${bytes.byteLength}`)
      } catch (error) {
        publishPlanDownloadError(error instanceof Error ? error.message : String(error), filename)
      } finally {
        try { await rm(savePath, { force: true }) } catch { /* best effort temp cleanup */ }
      }
    })
  })
}

function publishExternalAuth(entry, provider, url) {
  entry.externalAuthProvider = provider
  entry.view.setVisible(false)
  if (!mainWindow?.isDestroyed()) {
    mainWindow.webContents.send('wharness:chatgpt:external-auth', { provider, url: sanitizeDiagnosticURL(url), systemBrowserMode: true })
  }
  publishChatGPTState(activeChatGPTKey)
}

function routeChatGPTNavigation(entry, event, url) {
  const disposition = chatGPTNavigationDisposition(url)
  if (disposition.kind === 'trusted') return false
  event?.preventDefault?.()
  if (disposition.kind === 'external-auth') {
    publishExternalAuth(entry, disposition.provider, url)
    void shell.openExternal(url)
    return true
  }
  if (disposition.kind === 'external') void shell.openExternal(url)
  return true
}

function createChatGPTView(cacheKey) {
  const view = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION }) })
  view.setBackgroundColor('#ffffff')
  view.setVisible(false)
  const entry = { view, loading: true, lastUsed: Date.now(), lastNetworkActivity: Date.now(), externalAuthProvider: '' }
  chatgptViews.set(cacheKey, entry)
  mainWindow.contentView.addChildView(view)

  const wc = view.webContents
  wc.setUserAgent(CHATGPT_USER_AGENT)
  wc.setWindowOpenHandler(({ url }) => {
    routeChatGPTNavigation(entry, undefined, url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => { routeChatGPTNavigation(entry, event, url) })
  wc.on('will-redirect', (event, url) => { routeChatGPTNavigation(entry, event, url) })
  wc.on('did-start-loading', () => { entry.loading = true; touchChatGPTEntry(entry); publishChatGPTState(cacheKey) })
  wc.on('did-stop-loading', () => { entry.loading = false; touchChatGPTEntry(entry); publishChatGPTState(cacheKey) })
  wc.on('did-navigate', () => { touchChatGPTEntry(entry); publishChatGPTState(cacheKey) })
  wc.on('did-navigate-in-page', () => { touchChatGPTEntry(entry); publishChatGPTState(cacheKey) })
  wc.on('page-title-updated', () => publishChatGPTState(cacheKey))
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    console.error(`[chatgpt-load] key=${cacheKey} code=${code} main=${Boolean(isMainFrame)} url=${sanitizeDiagnosticURL(url)} error=${description}`)
  })
  wc.on('render-process-gone', (_event, details) => {
    console.error(`[chatgpt-renderer] key=${cacheKey} gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
  wc.on('unresponsive', () => console.error(`[chatgpt-renderer] key=${cacheKey} unresponsive`))
  void wc.loadURL(CHATGPT_URL, { userAgent: CHATGPT_USER_AGENT })
  evictChatGPTViews()
  return entry
}

function ensureChatGPTView(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = chatgptViews.get(key) || createChatGPTView(key)
  touchChatGPTEntry(entry)
  return { key, entry }
}

function activateChatGPTView(cacheKey, bounds) {
  const { key, entry } = ensureChatGPTView(cacheKey)
  const previous = activeChatGPTEntry()
  if (previous && previous !== entry) previous.view.setVisible(false)
  activeChatGPTKey = key
  if (bounds) setChatGPTBounds(bounds)
  else if (chatgptBounds) entry.view.setBounds(chatgptBounds)
  entry.view.setVisible(chatgptVisible && !entry.externalAuthProvider)
  touchChatGPTEntry(entry)
  evictChatGPTViews()
  publishChatGPTState(key)
  return entry
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchContextZip(sessionId) {
  const id = sanitizeSessionId(sessionId)
  const response = await fetch(contextBundleURL(BACKEND_URL, id), { redirect: 'error' })
  if (!response.ok) throw new Error(`Context bundle HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Backend did not return a ZIP bundle')
  return { id, bytes }
}

async function requireAutoSession(sessionId) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error' })
  if (!response.ok) throw new Error(`Session lookup HTTP ${response.status}`)
  const sessionState = await response.json()
  if (sessionState?.automation_mode !== 'auto') throw new Error('Automatic ChatGPT submission requires project Auto mode')
}

function decodeChatAttachmentSet(values) {
  if (!Array.isArray(values) || values.length > MAX_CHAT_ATTACHMENTS) throw new Error(`At most ${MAX_CHAT_ATTACHMENTS} chat attachments are allowed`)
  const decoded = values.map((value) => decodeUserAttachment(value, MAX_CHAT_ATTACHMENT_BYTES))
  const names = new Set()
  let total = 0
  for (const attachment of decoded) {
    const portableName = attachment.name.toLocaleLowerCase('en-US')
    if (names.has(portableName)) throw new Error(`Duplicate attachment filename: ${attachment.name}`)
    names.add(portableName)
    total += attachment.bytes.byteLength
  }
  if (total > MAX_CHAT_ATTACHMENTS_BYTES) throw new Error('Chat attachments exceed the 100 MiB total limit')
  return { decoded, total }
}

async function createPersistentAttachmentPreview(sourcePath, targetPath, mime, sourceBytes) {
  const safeRaster = SAFE_ATTACHMENT_IMAGE_MIMES.has(String(mime || '').toLowerCase()) && Number(sourceBytes || 0) <= MAX_ATTACHMENT_THUMBNAIL_SOURCE_BYTES
  let image = safeRaster ? nativeImage.createFromPath(sourcePath) : nativeImage.createEmpty()
  let kind = 'thumbnail'
  if (image.isEmpty()) {
    image = await app.getFileIcon(sourcePath, { size: 'large' })
    kind = 'icon'
  }
  if (image.isEmpty()) return 'none'
  const size = image.getSize()
  const scale = Math.min(1, 180 / Math.max(1, size.width), 120 / Math.max(1, size.height))
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
  await writeFile(targetPath, image.toPNG(), { mode: 0o600 })
  return kind
}

function chatAttachmentRoot() {
  return path.join(app.getPath('userData'), 'chat-attachments-v1')
}

async function materializeChatInput(cacheKey, sessionId, values, promptText, includeContext) {
  const { decoded, total } = decodeChatAttachmentSet(values)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', cacheKey)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const paths = []
  let contextBytes = 0
  if (includeContext) {
    const context = await fetchContextZip(sessionId)
    const contextPath = path.join(dir, `wharness-context-${context.id}.zip`)
    await writeFile(contextPath, context.bytes, { mode: 0o600 })
    paths.push(contextPath)
    contextBytes = context.bytes.byteLength
  }
  for (const attachment of decoded) {
    const target = path.join(dir, attachment.name)
    await writeFile(target, attachment.bytes, { mode: 0o600, flag: 'wx' })
    paths.push(target)
  }
  const prompt = plannerPromptMarkdown(promptText)
  const promptDir = path.join(dir, 'prompt')
  await mkdir(promptDir, { recursive: true, mode: 0o700 })
  const promptPath = path.join(promptDir, prompt.name)
  await writeFile(promptPath, prompt.bytes, { mode: 0o600, flag: 'wx' })
  return { paths, promptPath, userAttachmentCount: decoded.length, bytes: contextBytes + total + prompt.bytes.byteLength }
}

async function targetChatGPTComposer(cacheKey, expectedURL = '', preferCurrentConversation = false) {
  const key = sanitizeChatCacheKey(cacheKey)
  const { entry } = ensureChatGPTView(key)
  const wc = entry.view.webContents
  if (entry.externalAuthProvider) throw new Error(`ChatGPT está em autenticação externa via ${entry.externalAuthProvider}. Use o navegador do sistema e importe o bundle ZIP pelo Wharness.`)
  if (expectedURL) {
    const target = requireTrustedChatGPTURL(expectedURL)
    const keepCurrent = preferCurrentConversation && Boolean(chatGPTConversationID(wc.getURL()))
    if (!sameConversationURL(wc.getURL(), target) && !keepCurrent) await wc.loadURL(target, { userAgent: CHATGPT_USER_AGENT })
  }
  await waitForChatGPTSurfaceReady(entry)
  const focused = await wc.executeJavaScript(chatGPTFocusComposerScript(), true)
  if (!focused) throw new Error('ChatGPT composer DOM was not found')
  touchChatGPTEntry(entry)
  return { key, entry, wc, conversationUrl: canonicalChatGPTConversationURL(wc.getURL()) }
}

async function waitForChatGPTSurfaceReady(entry) {
  const wc = entry.view.webContents
  await waitForChatGPTReady({
    isLoading: () => entry.loading || wc.isLoading(),
    lastNetworkActivity: () => entry.lastNetworkActivity,
    wait,
  })
  if (!isTrustedChatGPTOrigin(wc.getURL())) throw new Error('Active cached view is not a trusted ChatGPT page')
}

async function pasteChatGPTFile(entry, filePath, index, count) {
  const wc = entry.view.webContents
  const result = await pasteWithUploadRetry({
    beforeAttempt: async () => {
      await waitForChatGPTSurfaceReady(entry)
      const focused = await wc.executeJavaScript(chatGPTFocusComposerScript(), true)
      if (!focused) throw new Error('ChatGPT composer DOM was not found before upload')
    },
    beginUpload: () => chatGPTUploads.expect(wc.id),
    paste: async () => {
      await clipboard.write([new ClipboardItem({ 'text/uri-list': `${pathToFileURL(filePath).href}\r\n` })])
      wc.paste()
    },
    onRetry: ({ attempt, error }) => {
      console.warn(`[chatgpt-upload] retry wc=${wc.id} file=${index}/${count} failedAttempt=${attempt} error=${error.message}`)
    },
  })
  console.log(`[chatgpt-upload] confirmed wc=${wc.id} file=${index}/${count} observed=${result.observed}`)
}

async function submitChatGPTDraft(key) {
  const target = await targetChatGPTComposer(key)
  const wc = target.wc
  const observed = chatGPTSubmissions.expect(wc.id)
  const clicked = await wc.executeJavaScript(chatGPTSubmitScript(), true)
  if (!clicked) dispatchChatGPTSubmit(wc)
  try {
    const result = await observed
    console.log(`[chatgpt-submit] accepted key=${key} method=${clicked ? 'dom-click' : 'native-enter'} request=${result.requestId}`)
    return result
  } catch (error) {
    const observationError = error instanceof Error ? error.message : String(error)
    console.warn(`[chatgpt-submit] dispatched-unconfirmed key=${key} method=${clicked ? 'dom-click' : 'native-enter'} observation=${observationError}`)
    return { accepted: false, requestId: '', observationError }
  }
}

async function preparePromptForChatGPT(request) {
  const text = String(request?.text || '').trim()
  if (!text) throw new Error('Prepared prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const requestId = String(request?.requestId || '').trim()
  const expectedFilename = canonicalBundleFilename(requestId)
  const autoSubmit = request?.autoSubmit === true
  if (autoSubmit) await requireAutoSession(request?.sessionId)
  const target = await targetChatGPTComposer(key, request?.url || '', request?.preferCurrentConversation === true)
  const currentSha = String(request?.contextSha256 || '').trim()
  const previousSha = String(request?.lastContextSha256 || '').trim()
  const previousURL = String(request?.lastContextChatgptUrl || '').trim()
  const includeContext = shouldAttachProjectContext({ currentSha, previousSha, currentConversationId: chatGPTConversationID(target.conversationUrl), previousConversationId: chatGPTConversationID(previousURL), force: request?.includeContext === true })
  const input = await materializeChatInput(key, request?.sessionId, request?.attachments || [], text, includeContext)
  const transportPaths = [...input.paths, input.promptPath]
  for (let index = 0; index < transportPaths.length; index += 1) {
    await pasteChatGPTFile(target.entry, transportPaths[index], index + 1, transportPaths.length)
  }
  if (autoSubmit) {
    await wait(chatInputSettleDelay(input.bytes, transportPaths.length))
    await submitChatGPTDraft(key)
    armExpectedChatGPTBundle(key, requestId)
    preparedChatGPTDrafts.delete(key)
  } else {
    preparedChatGPTDrafts.set(key, { preparedAt: Date.now(), attachmentCount: transportPaths.length, requestId })
  }
  touchChatGPTEntry(target.entry)
  console.log(`[chatgpt-draft] prepared key=${key} attachments=${transportPaths.length} includeContext=${includeContext} bytes=${input.bytes} chars=${text.length} autoSubmit=${autoSubmit}`)
  return { ok: true, cacheKey: key, attachmentCount: transportPaths.length, submitted: autoSubmit, expectedFilename, includedContext: includeContext, conversationUrl: target.conversationUrl }
}

async function attachContextToChatGPT(request) {
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const target = await targetChatGPTComposer(key, request?.url || '', true)
  const context = await fetchContextZip(request?.sessionId)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-context')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, `wharness-context-${context.id}.zip`)
  await writeFile(filePath, context.bytes, { mode: 0o600 })
  await pasteChatGPTFile(target.entry, filePath, 1, 1)
  await wait(chatInputSettleDelay(context.bytes.byteLength, 1))
  const submission = await submitChatGPTDraft(key)
  if (!submission.accepted) throw new Error('ChatGPT context submission was dispatched but could not be confirmed')
  touchChatGPTEntry(target.entry)
  return { ok: true, cacheKey: key, bytes: context.bytes.byteLength, submitted: true, conversationUrl: canonicalChatGPTConversationURL(target.wc.getURL()) || target.conversationUrl }
}

async function attachPromptToChatGPT(request) {
  const text = String(request?.text || '').trim()
  if (!text) throw new Error('Prepared prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const target = await targetChatGPTComposer(key, request?.url || '', true)
  const prompt = plannerPromptMarkdown(text)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-prompt')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, prompt.name)
  await writeFile(filePath, prompt.bytes, { mode: 0o600 })
  await pasteChatGPTFile(target.entry, filePath, 1, 1)
  await wait(chatInputSettleDelay(prompt.bytes.byteLength, 1))
  const submission = await submitChatGPTDraft(key)
  if (!submission.accepted) throw new Error('ChatGPT prompt submission was dispatched but could not be confirmed')
  touchChatGPTEntry(target.entry)
  return { ok: true, cacheKey: key, bytes: prompt.bytes.byteLength, submitted: true, conversationUrl: canonicalChatGPTConversationURL(target.wc.getURL()) || target.conversationUrl }
}

async function submitPreparedChatGPTDraft(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  const prepared = preparedChatGPTDrafts.get(key)
  if (!prepared || Date.now() - prepared.preparedAt > 10 * 60 * 1000) throw new Error('No recent prepared ChatGPT draft exists for this chat')
  const entry = activateChatGPTView(key)
  await submitChatGPTDraft(key)
  const expectedFilename = armExpectedChatGPTBundle(key, prepared.requestId)
  preparedChatGPTDrafts.delete(key)
  touchChatGPTEntry(entry)
  return { ok: true, cacheKey: key, expectedFilename }
}

async function submitPromptToChatGPT(cacheKey, value, expectedURL = '', requestId = '') {
  const text = String(value || '').trim()
  if (!text) throw new Error('Repair prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Repair prompt exceeds 1 MiB limit')

  const key = sanitizeChatCacheKey(cacheKey)
  const expectedFilename = canonicalBundleFilename(requestId)
  const target = await targetChatGPTComposer(key, expectedURL)
  const filled = await target.wc.executeJavaScript(chatGPTFillComposerScript(text), true)
  if (!filled) throw new Error('ChatGPT composer DOM could not be populated')
  await wait(100)
  await submitChatGPTDraft(key)
  armExpectedChatGPTBundle(key, requestId)
  touchChatGPTEntry(target.entry)
  console.log(`[chatgpt-repair] submitted key=${key} chars=${text.length} method=dom`)
  return { ok: true, cacheKey: key, expectedFilename }
}

async function pollExpectedChatGPTDownloads() {
  const now = Date.now()
  for (const [key, expected] of expectedChatGPTBundles) {
    if (now - expected.armedAt > EXPECTED_BUNDLE_TTL_MS) {
      expectedChatGPTBundles.delete(key)
      continue
    }
    if (expected.lastDOMClick && now - expected.lastDOMClick < DOM_DOWNLOAD_RETRY_MS) continue
    const entry = chatgptViews.get(key)
    const wc = entry?.view.webContents
    if (!entry || wc?.isDestroyed() || entry.loading || !isTrustedChatGPTOrigin(wc.getURL())) continue
    try {
      const clicked = await wc.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename), true)
      if (!clicked) continue
      expected.lastDOMClick = now
      recentExpectedDownload = { key, requestId: expected.requestId, at: now }
      console.log(`[chatgpt-bundle-dom] download-triggered key=${key} file=${expected.filename}`)
      break
    } catch (error) {
      console.warn(`[chatgpt-bundle-dom] scan-failed key=${key} error=${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function exportBrowserSession() {
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  await chatSession.flushStorageData()
  closeAllChatGPTViews()
  const snapshot = await snapshotBrowserSession(chatGPTPartitionPath())
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar sessão do navegador Wharness',
    defaultPath: path.join(app.getPath('downloads'), `wharness-browser-session-${new Date().toISOString().slice(0, 10)}.whbs`),
    filters: [{ name: 'Wharness Browser Session', extensions: ['whbs'] }],
  })
  if (result.canceled || !result.filePath) return { cancelled: true }
  await writeFile(result.filePath, snapshot, { mode: 0o600 })
  return { cancelled: false, bytes: snapshot.byteLength, filename: path.basename(result.filePath) }
}

async function importBrowserSession() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar sessão do navegador Wharness',
    defaultPath: app.getPath('downloads'),
    properties: ['openFile'],
    filters: [{ name: 'Wharness Browser Session', extensions: ['whbs'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
  const raw = await readFile(result.filePaths[0])
  const validationRoot = path.join(app.getPath('temp'), `wharness-browser-import-${process.pid}`)
  const restored = await restoreBrowserSession(validationRoot, raw)
  await rm(validationRoot, { recursive: true, force: true })
  await writeFile(pendingBrowserImportPath(), raw, { mode: 0o600 })
  closeAllChatGPTViews()
  setTimeout(() => { app.relaunch(); app.exit(0) }, 500)
  return { cancelled: false, restarting: true, ...restored }
}

async function applyPendingBrowserSessionImport() {
  let raw
  try { raw = await readFile(pendingBrowserImportPath()) } catch { return false }
  await restoreBrowserSession(chatGPTPartitionPath(), raw)
  await rm(pendingBrowserImportPath(), { force: true })
  console.log('[chatgpt-session] imported browser session before partition startup')
  return true
}

async function clearBrowserSession() {
  closeAllChatGPTViews()
  preparedChatGPTDrafts.clear()
  expectedChatGPTBundles.clear()
  recentExpectedDownload = undefined
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  await chatSession.clearStorageData()
  await chatSession.clearCache()
  await chatSession.flushStorageData()
  return { ok: true }
}

async function desktopStorageUsage() {
  const userData = app.getPath('userData')
  const browserBytes = await pathSize(chatGPTPartitionPath())
  const attachmentBytes = await pathSize(chatAttachmentRoot())
  let tempBytes = 0
  let entries = []
  try { entries = await readdir(app.getPath('temp'), { withFileTypes: true }) } catch { /* best effort */ }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^(wharness-(bundles|plans|context|chat-inputs))$/.test(entry.name)) continue
    tempBytes += await pathSize(path.join(app.getPath('temp'), entry.name))
  }
  const userDataBytes = await pathSize(userData)
  return { total_bytes: userDataBytes + tempBytes, user_data_bytes: userDataBytes, browser_bytes: browserBytes, attachment_bytes: attachmentBytes, temp_bytes: tempBytes, other_user_data_bytes: Math.max(0, userDataBytes - browserBytes - attachmentBytes) }
}

async function clearDesktopWharnessData() {
  await clearBrowserSession()
  const localSession = session.defaultSession
  await localSession.clearStorageData()
  await localSession.clearCache()
  await localSession.flushStorageData()
  await rm(chatAttachmentRoot(), { recursive: true, force: true })
  await rm(pendingBrowserImportPath(), { force: true })
  for (const name of ['wharness-bundles', 'wharness-plans', 'wharness-context', 'wharness-chat-inputs']) {
    await rm(path.join(app.getPath('temp'), name), { recursive: true, force: true })
  }
  return { ok: true }
}

function chatGPTConversationID(value) {
  try {
    const trusted = requireTrustedChatGPTURL(value)
    return /^\/c\/([^/]+)/.exec(new URL(trusted).pathname)?.[1] || ''
  } catch { return '' }
}

function canonicalChatGPTConversationURL(value) {
  const id = chatGPTConversationID(value)
  return id ? `https://chatgpt.com/c/${id}` : ''
}

function sameConversationURL(left, right) {
  const a = chatGPTConversationID(left)
  const b = chatGPTConversationID(right)
  return Boolean(a && b && a === b)
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
    closeAllChatGPTViews()
    expectedChatGPTBundles.clear()
    mainWindow = undefined
  })

  void mainWindow.loadURL(FRONTEND_URL)
}

function registerIPC() {
  ipcMain.handle('wharness:projects:pick-directory', async (event, request) => {
    trustedSender(event)
    const result = await dialog.showOpenDialog(mainWindow, {
      title: typeof request?.title === 'string' ? request.title.slice(0, 120) : 'Selecionar pasta',
      defaultPath: typeof request?.defaultPath === 'string' && path.isAbsolute(request.defaultPath) ? request.defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    })
    return { cancelled: result.canceled || result.filePaths.length === 0, path: result.filePaths[0] || '' }
  })
  ipcMain.handle('wharness:chatgpt:show', async (event, request) => {
    trustedSender(event)
    chatgptVisible = true
    const entry = activateChatGPTView(request?.cacheKey, request?.bounds)
    await waitForChatGPTSurfaceReady(entry)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:hide', (event) => {
    trustedSender(event)
    chatgptVisible = false
    activeChatGPTEntry()?.view.setVisible(false)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:set-bounds', (event, bounds) => {
    trustedSender(event)
    return { ok: chatgptVisible ? setChatGPTBounds(bounds) : false }
  })
  ipcMain.handle('wharness:chatgpt:navigate', async (event, request) => {
    trustedSender(event)
    const target = requireTrustedChatGPTURL(request?.url || CHATGPT_URL)
    const entry = activateChatGPTView(request?.cacheKey)
    const wc = entry.view.webContents
    const current = wc.getURL()
    const targetIsHome = target === CHATGPT_URL
    const resetToHome = Boolean(request?.resetToHomeIfConversation && targetIsHome && chatGPTConversationID(current))
    const keepCachedDOM = !resetToHome && targetIsHome && isTrustedChatGPTOrigin(current) && current !== 'about:blank'
    if (resetToHome || (!keepCachedDOM && current !== target && !sameConversationURL(current, target))) {
      await wc.loadURL(target, { userAgent: CHATGPT_USER_AGENT })
    }
    return currentChatGPTState()
  })
  ipcMain.handle('wharness:chatgpt:reload', (event) => { trustedSender(event); activeChatGPTEntry()?.view.webContents.reload(); return { ok: true } })
  ipcMain.handle('wharness:chatgpt:focus', (event) => { trustedSender(event); activeChatGPTEntry()?.view.webContents.focus(); return { ok: true } })
  ipcMain.handle('wharness:chatgpt:back', (event) => {
    trustedSender(event)
    const wc = activeChatGPTEntry()?.view.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:forward', (event) => {
    trustedSender(event)
    const wc = activeChatGPTEntry()?.view.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:state', (event) => { trustedSender(event); return currentChatGPTState() })
  ipcMain.handle('wharness:chatgpt:open-external', async (event, request) => {
    trustedSender(event)
    const target = requireTrustedChatGPTURL(request?.url || CHATGPT_URL)
    await shell.openExternal(target)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:resume-embedded', async (event, request) => {
    trustedSender(event)
    const entry = activateChatGPTView(request?.cacheKey)
    entry.externalAuthProvider = ''
    const wc = entry.view.webContents
    if (!isTrustedChatGPTOrigin(wc.getURL())) await wc.loadURL(CHATGPT_URL, { userAgent: CHATGPT_USER_AGENT })
    entry.view.setVisible(chatgptVisible)
    publishChatGPTState(activeChatGPTKey)
    return currentChatGPTState()
  })
  ipcMain.handle('wharness:chatgpt:pick-bundle', async (event, request) => {
    trustedSender(event)
    const requestId = String(request?.requestId || '').trim()
    const expectedFilename = canonicalBundleFilename(requestId)
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Selecionar ${expectedFilename}`,
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Wharness bundle ZIP', extensions: ['zip'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    const filePath = result.filePaths[0]
    const sourceFilename = path.basename(filePath)
    const bytes = await readFile(filePath)
    if (bytes.byteLength > MAX_EXECUTION_BUNDLE_BYTES) throw new Error('Bundle Wharness excede o limite de 16 MiB.')
    const candidate = canonicalWharnessBundleDownload(sourceFilename, requestId, 'application/zip')
    if (!candidate) throw new Error('O ficheiro selecionado não é um bundle ZIP Wharness reconhecível.')
    const validated = validateWharnessBundleDownload(candidate.filename, bytes)
    if (validated.requestId !== requestId) throw new Error('O bundle selecionado não pertence ao pedido ativo.')
    return {
      cancelled: false,
      filename: candidate.filename,
      requestId: validated.requestId,
      sourceFilename,
      normalizedFilename: candidate.normalized,
      bytes: bytes.byteLength,
      contentBase64: bytes.toString('base64'),
    }
  })
  ipcMain.handle('wharness:chatgpt:paste', (event) => { trustedSender(event); activeChatGPTEntry()?.view.webContents.paste(); return { ok: true } })
  ipcMain.handle('wharness:chatgpt:submit-prompt', async (event, request) => {
    trustedSender(event)
    return submitPromptToChatGPT(request?.cacheKey, request?.text, request?.url, request?.requestId)
  })
  ipcMain.handle('wharness:chatgpt:prepare-prompt', async (event, request) => {
    trustedSender(event)
    return preparePromptForChatGPT(request)
  })
  ipcMain.handle('wharness:chatgpt:attach-context', async (event, request) => {
    trustedSender(event)
    return attachContextToChatGPT(request)
  })
  ipcMain.handle('wharness:chatgpt:attach-prompt', async (event, request) => {
    trustedSender(event)
    return attachPromptToChatGPT(request)
  })
  ipcMain.handle('wharness:chatgpt:submit-prepared', async (event, request) => {
    trustedSender(event)
    return submitPreparedChatGPTDraft(request?.cacheKey)
  })
  ipcMain.handle('wharness:data:storage', async (event) => { trustedSender(event); return desktopStorageUsage() })
  ipcMain.handle('wharness:data:export-browser-session', async (event) => { trustedSender(event); return exportBrowserSession() })
  ipcMain.handle('wharness:data:import-browser-session', async (event) => { trustedSender(event); return importBrowserSession() })
  ipcMain.handle('wharness:data:clear-browser-session', async (event) => { trustedSender(event); return clearBrowserSession() })
  ipcMain.handle('wharness:data:clear-all', async (event, request) => {
    trustedSender(event)
    if (String(request?.confirm || '').trim() !== 'APAGAR WHARNESS') throw new Error('Complete Wharness reset confirmation mismatch')
    return clearDesktopWharnessData()
  })
  ipcMain.handle('wharness:attachments:persist', async (event, request) => {
    trustedSender(event)
    const cacheKey = sanitizeChatCacheKey(request?.cacheKey)
    const messageId = sanitizeChatCacheKey(request?.messageId)
    const { decoded } = decodeChatAttachmentSet(request?.attachments || [])
    const attachments = await persistChatAttachmentFiles(chatAttachmentRoot(), cacheKey, messageId, decoded, createPersistentAttachmentPreview)
    return { ok: true, attachments }
  })
  ipcMain.handle('wharness:attachments:preview', async (event, request) => {
    trustedSender(event)
    try { return await readStoredAttachmentPreview(chatAttachmentRoot(), request?.storageRef) }
    catch { return { available: false, dataUrl: '', previewKind: 'none' } }
  })
  ipcMain.handle('wharness:attachments:open', async (event, request) => {
    trustedSender(event)
    const filePath = await storedAttachmentPath(chatAttachmentRoot(), request?.storageRef)
    const error = await shell.openPath(filePath)
    if (error) throw new Error(`Não foi possível abrir o anexo: ${error}`)
    return { ok: true }
  })
  ipcMain.handle('wharness:attachments:remove-chat', async (event, request) => {
    trustedSender(event)
    const cacheKey = sanitizeChatCacheKey(request?.cacheKey)
    await removeStoredChatAttachments(chatAttachmentRoot(), cacheKey)
    return { ok: true }
  })
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
    const { id: sessionId, bytes } = await fetchContextZip(request?.sessionId)

    const dir = path.join(app.getPath('temp'), 'wharness-context', sessionId)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `wharness-context-${sessionId}.zip`)
    await writeFile(filePath, bytes, { mode: 0o600 })
    await clipboard.write([new ClipboardItem({ 'text/uri-list': `${pathToFileURL(filePath).href}\r\n` })])
    return { ok: true, bytes: bytes.byteLength }
  })
}

app.whenReady().then(async () => {
  try { await applyPendingBrowserSessionImport() } catch (error) { console.error('[chatgpt-session] pending import failed', error) }
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  chatSession.setUserAgent(CHATGPT_USER_AGENT, CHATGPT_ACCEPT_LANGUAGES)
  registerChatGPTPlanDownloads(chatSession)

  const remoteFilter = {
    urls: [
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://*.openai.com/*',
    ],
  }
  chatSession.webRequest.onBeforeRequest(remoteFilter, (details, callback) => {
    noteChatGPTNetworkActivity(details)
    chatGPTUploads.onBeforeRequest(details)
    chatGPTSubmissions.onBeforeRequest(details)
    callback({})
  })
  chatSession.webRequest.onErrorOccurred(remoteFilter, (details) => {
    noteChatGPTNetworkActivity(details)
    chatGPTUploads.onErrorOccurred(details)
    console.error(`[chatgpt-net] ${details.method} ${sanitizeDiagnosticURL(details.url)} error=${details.error}`)
  })
  chatSession.webRequest.onCompleted(remoteFilter, (details) => {
    noteChatGPTNetworkActivity(details)
    chatGPTUploads.onCompleted(details)
    if (details.statusCode >= 400) {
      console.error(`[chatgpt-http] ${details.method} ${sanitizeDiagnosticURL(details.url)} status=${details.statusCode}`)
    }
  })

  // Remote ChatGPT gets the minimum browser permissions it needs. In particular,
  // navigator.clipboard.writeText() maps to clipboard-sanitized-write in Electron.
  // We deliberately do NOT grant clipboard-read: importing a response remains an
  // explicit Wharness action owned by the trusted local renderer/main process.
  chatSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingURL = details?.requestingUrl || webContents?.getURL() || ''
    const trusted = isTrustedChatGPTOrigin(requestingURL)
    const allowed = trusted && (permission === 'notifications' || permission === 'clipboard-sanitized-write')
    if (permission.startsWith('clipboard')) {
      console.log(`[chatgpt-permission] ${permission} origin=${sanitizeDiagnosticURL(requestingURL)} allowed=${allowed}`)
    }
    callback(allowed)
  })
  chatSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const requestingURL = details?.requestingUrl || requestingOrigin || details?.embeddingOrigin || ''
    const trusted = isTrustedChatGPTOrigin(requestingURL)
    return trusted && (permission === 'notifications' || permission === 'clipboard-sanitized-write')
  })

  // Cache only: preserve cookies/login while forcing current ChatGPT assets to reload
  // under the Chrome-compatible UA. Failures here must not prevent startup.
  try { await chatSession.clearCache() } catch (error) { console.error('[chatgpt-cache] clear failed', error) }

  console.log(`ChatGPT compatibility UA: Chrome/${CHATGPT_CHROMIUM_VERSION}`)
  registerIPC()
  chatGPTDownloadPoller = setInterval(() => { void pollExpectedChatGPTDownloads() }, DOM_DOWNLOAD_POLL_MS)
  createWindow()
})

app.on('before-quit', () => { if (chatGPTDownloadPoller) clearInterval(chatGPTDownloadPoller) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
