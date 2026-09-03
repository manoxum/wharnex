import { app, BrowserWindow, ClipboardItem, WebContentsView, clipboard, ipcMain, nativeImage, session, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ChatGPTSubmitCoordinator, dispatchChatGPTSubmit, submitWithoutReplay } from './chatgpt-input.mjs'
import { ChatGPTUploadCoordinator, chatGPTComposerPoint, pasteWithUploadRetry, plannerPromptMarkdown, waitForChatGPTReady } from './chatgpt-upload.mjs'
import { persistChatAttachmentFiles, readStoredAttachmentPreview, removeStoredChatAttachments, storedAttachmentPath } from './chat-attachment-store.mjs'
import { chatInputSettleDelay, chromeCompatibleUserAgent, contextBundleURL, decodeUserAttachment, externalAuthProvider, isHTTPS, isTrustedChatGPTOrigin, normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, sanitizeChatCacheKey, sanitizeDiagnosticURL, sanitizeSessionId, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename } from './security.mjs'

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
    const filename = item.getFilename()
    const bundleRequestId = wharnessBundleRequestIdFromFilename(filename)
    if (bundleRequestId) {
      const sourceURL = sourceWebContents?.getURL?.() || ''
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
          publishBundleDownload({ filename, requestId: validated.requestId, contentBase64: bytes.toString('base64'), bytes: bytes.byteLength })
          console.log(`[chatgpt-bundle-download] imported file=${filename} bytes=${bytes.byteLength}`)
        } catch (error) {
          publishBundleDownloadError(error instanceof Error ? error.message : String(error), filename)
        } finally {
          try { await rm(savePath, { force: true }) } catch { /* best effort temp cleanup */ }
        }
      })
      return
    }
    if (filename.startsWith('wharness-bundle-')) {
      item.cancel()
      publishBundleDownloadError('Nome do bundle inválido; esperado wharness-bundle-<request_id>.zip.', filename)
      return
    }

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

function createChatGPTView(cacheKey) {
  const view = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION }) })
  view.setBackgroundColor('#ffffff')
  view.setVisible(false)
  const entry = { view, loading: true, lastUsed: Date.now(), lastNetworkActivity: Date.now() }
  chatgptViews.set(cacheKey, entry)
  mainWindow.contentView.addChildView(view)

  const wc = view.webContents
  wc.setUserAgent(CHATGPT_USER_AGENT)
  wc.setWindowOpenHandler(({ url }) => {
    if (!isHTTPS(url)) return { action: 'deny' }
    const provider = externalAuthProvider(url)
    if (provider) {
      void shell.openExternal(url)
      if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('wharness:chatgpt:external-auth', { provider, url })
      return { action: 'deny' }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => { if (!isHTTPS(url)) event.preventDefault() })
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
  entry.view.setVisible(chatgptVisible)
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

async function materializeChatInput(cacheKey, sessionId, values, promptText) {
  const { decoded, total } = decodeChatAttachmentSet(values)
  const context = await fetchContextZip(sessionId)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', cacheKey)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const contextPath = path.join(dir, `wharness-context-${context.id}.zip`)
  await writeFile(contextPath, context.bytes, { mode: 0o600 })
  const paths = [contextPath]
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
  return {
    paths,
    promptPath,
    userAttachmentCount: decoded.length,
    bytes: context.bytes.byteLength + total + prompt.bytes.byteLength,
  }
}

async function focusChatGPTComposer(cacheKey, expectedURL = '') {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = activateChatGPTView(key)
  const wc = entry.view.webContents
  if (expectedURL) {
    const target = requireTrustedChatGPTURL(expectedURL)
    if (!sameConversationURL(wc.getURL(), target)) await wc.loadURL(target, { userAgent: CHATGPT_USER_AGENT })
  }
  await waitForChatGPTSurfaceReady(entry)
  if (!isTrustedChatGPTOrigin(wc.getURL())) throw new Error('Active cached view is not a trusted ChatGPT page')
  let bounds = entry.view.getBounds()
  for (let attempt = 0; attempt < 30 && (bounds.width < 200 || bounds.height < 120 || !chatgptVisible); attempt += 1) {
    await wait(100)
    bounds = entry.view.getBounds()
  }
  if (bounds.width < 200 || bounds.height < 120 || !chatgptVisible) throw new Error('ChatGPT pane is not visible or ready for input')
  const point = chatGPTComposerPoint(bounds, wc.getURL())
  wc.focus()
  wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  await wait(100)
  return { key, entry, wc }
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
    beforeAttempt: () => waitForChatGPTSurfaceReady(entry),
    beginUpload: () => chatGPTUploads.expect(wc.id),
    paste: async () => {
      await clipboard.write([new ClipboardItem({ 'text/uri-list': `${pathToFileURL(filePath).href}\r\n` })])
      wc.focus()
      wc.paste()
    },
    onRetry: ({ attempt, error }) => {
      console.warn(`[chatgpt-upload] retry key=${activeChatGPTKey} file=${index}/${count} failedAttempt=${attempt} error=${error.message}`)
    },
  })
  console.log(`[chatgpt-upload] confirmed key=${activeChatGPTKey} file=${index}/${count} observed=${result.observed}`)
}

async function submitChatGPTDraft(key) {
  let wc
  const result = await submitWithoutReplay({
    beforeSubmit: async () => {
      const target = await focusChatGPTComposer(key)
      wc = target.wc
    },
    beginObservation: () => chatGPTSubmissions.expect(wc.id),
    submit: () => dispatchChatGPTSubmit(wc),
  })
  if (result.accepted) {
    console.log(`[chatgpt-submit] accepted key=${key} method=native-enter request=${result.requestId}`)
  } else {
    console.warn(`[chatgpt-submit] dispatched-unconfirmed key=${key} method=native-enter observation=${result.observationError}`)
  }
  return result
}

async function preparePromptForChatGPT(request) {
  const text = String(request?.text || '').trim()
  if (!text) throw new Error('Prepared prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const autoSubmit = request?.autoSubmit === true
  if (autoSubmit) await requireAutoSession(request?.sessionId)
  const input = await materializeChatInput(key, request?.sessionId, request?.attachments || [], text)
  const target = await focusChatGPTComposer(key, request?.url || '')
  const transportPaths = [...input.paths, input.promptPath]
  for (let index = 0; index < transportPaths.length; index += 1) {
    await pasteChatGPTFile(target.entry, transportPaths[index], index + 1, transportPaths.length)
  }
  if (autoSubmit) {
    await wait(chatInputSettleDelay(input.bytes, transportPaths.length))
    await submitChatGPTDraft(key)
    preparedChatGPTDrafts.delete(key)
  } else {
    preparedChatGPTDrafts.set(key, { preparedAt: Date.now(), attachmentCount: transportPaths.length })
  }
  touchChatGPTEntry(target.entry)
  console.log(`[chatgpt-draft] prepared key=${key} attachments=${transportPaths.length} bytes=${input.bytes} chars=${text.length} autoSubmit=${autoSubmit}`)
  return { ok: true, cacheKey: key, attachmentCount: transportPaths.length, submitted: autoSubmit }
}

async function submitPreparedChatGPTDraft(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  const prepared = preparedChatGPTDrafts.get(key)
  if (!prepared || Date.now() - prepared.preparedAt > 10 * 60 * 1000) throw new Error('No recent prepared ChatGPT draft exists for this chat')
  const entry = activateChatGPTView(key)
  await submitChatGPTDraft(key)
  preparedChatGPTDrafts.delete(key)
  touchChatGPTEntry(entry)
  return { ok: true, cacheKey: key }
}

async function submitPromptToChatGPT(cacheKey, value, expectedURL = '') {
  const text = String(value || '').trim()
  if (!text) throw new Error('Repair prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Repair prompt exceeds 1 MiB limit')

  const key = sanitizeChatCacheKey(cacheKey)
  const entry = activateChatGPTView(key)
  const wc = entry.view.webContents
  if (expectedURL) {
    const target = requireTrustedChatGPTURL(expectedURL)
    const current = wc.getURL()
    if (!sameConversationURL(current, target)) {
      await wc.loadURL(target, { userAgent: CHATGPT_USER_AGENT })
    }
  }
  for (let attempt = 0; attempt < 50 && entry.loading; attempt += 1) await wait(100)
  if (!isTrustedChatGPTOrigin(wc.getURL())) throw new Error('Active cached view is not a trusted ChatGPT page')

  // Input-only automation: focus the fixed ChatGPT composer area, paste the
  // prepared repair request and click Submit. Wharness never reads or scrapes
  // the remote DOM; the response still returns through the file-first download
  // contract.
  const bounds = entry.view.getBounds()
  const { x, y } = chatGPTComposerPoint(bounds, wc.getURL())
  wc.focus()
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await wait(80)
  clipboard.writeText(text)
  wc.paste()
  await wait(120)
  await submitChatGPTDraft(key)
  touchChatGPTEntry(entry)
  console.log(`[chatgpt-repair] submitted key=${key} chars=${text.length} method=native-enter`)
  return { ok: true, cacheKey: key }
}

function chatGPTConversationID(value) {
  try {
    const trusted = requireTrustedChatGPTURL(value)
    return /^\/c\/([^/]+)/.exec(new URL(trusted).pathname)?.[1] || ''
  } catch { return '' }
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
    for (const entry of chatgptViews.values()) {
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    }
    chatgptViews = new Map()
    activeChatGPTKey = ''
    mainWindow = undefined
  })

  void mainWindow.loadURL(FRONTEND_URL)
}

function registerIPC() {
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
  ipcMain.handle('wharness:chatgpt:open-external', async (event) => {
    trustedSender(event)
    await shell.openExternal(CHATGPT_URL)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:paste', (event) => { trustedSender(event); activeChatGPTEntry()?.view.webContents.paste(); return { ok: true } })
  ipcMain.handle('wharness:chatgpt:submit-prompt', async (event, request) => {
    trustedSender(event)
    return submitPromptToChatGPT(request?.cacheKey, request?.text, request?.url)
  })
  ipcMain.handle('wharness:chatgpt:prepare-prompt', async (event, request) => {
    trustedSender(event)
    return preparePromptForChatGPT(request)
  })
  ipcMain.handle('wharness:chatgpt:submit-prepared', async (event, request) => {
    trustedSender(event)
    return submitPreparedChatGPTDraft(request?.cacheKey)
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
  createWindow()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
