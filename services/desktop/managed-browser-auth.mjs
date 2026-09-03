import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const CHATGPT_HOST = 'chatgpt.com'
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function pathCandidates(platform, env) {
  const configured = String(env.WHARNESS_BROWSER_EXECUTABLE || '').trim()
  if (configured) return [configured]
  if (platform === 'win32') {
    return [
      path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      path.join(env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    ]
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  }
  const names = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'brave-browser', 'brave-browser-stable']
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean)
  return names.flatMap((name) => dirs.map((dir) => path.join(dir, name)))
}

export function resolveManagedBrowserExecutable(platform = process.platform, env = process.env, exists = existsSync) {
  return pathCandidates(platform, env).find((candidate) => candidate && exists(candidate)) || ''
}

export function isChatGPTCookie(cookie) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase()
  if (!(domain === CHATGPT_HOST || domain.endsWith(`.${CHATGPT_HOST}`))) return false
  const name = String(cookie?.name || '')
  if (/^(?:__cf|cf_)/i.test(name)) return false
  return Boolean(name && typeof cookie?.value === 'string')
}


function hasAuthenticatedSessionCookie(cookies) {
  return (cookies || []).some((cookie) => isChatGPTCookie(cookie) && /(?:authjs|next-auth).*session-token|^oai(?:[-_].*)?session(?:[-_].*)?$/i.test(String(cookie.name || '')))
}
export function electronCookieDetails(cookie) {
  if (!isChatGPTCookie(cookie)) return undefined
  const host = String(cookie.domain).replace(/^\./, '')
  const secure = cookie.secure !== false
  const details = {
    url: `${secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
    name: String(cookie.name),
    value: String(cookie.value),
    path: cookie.path || '/',
    secure,
    httpOnly: Boolean(cookie.httpOnly),
  }
  if (String(cookie.domain).startsWith('.') && !details.name.startsWith('__Host-')) details.domain = String(cookie.domain)
  if (Number.isFinite(cookie.expires) && cookie.expires > 0) details.expirationDate = Number(cookie.expires)
  if (cookie.sameSite === 'Strict') details.sameSite = 'strict'
  else if (cookie.sameSite === 'Lax') details.sameSite = 'lax'
  else if (cookie.sameSite === 'None') details.sameSite = 'no_restriction'
  return details
}

async function reserveLoopbackPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('Não foi possível reservar uma porta local para o navegador de autenticação.')
  return port
}

async function fetchJSON(url, timeoutMs = 1500) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  if (!response.ok) throw new Error(`DevTools respondeu HTTP ${response.status}`)
  return response.json()
}

async function cdpCommand(webSocketDebuggerUrl, method, params = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl)
    const timer = setTimeout(() => { try { ws.close() } catch {}; reject(new Error(`CDP timeout em ${method}`)) }, timeoutMs)
    const finish = (error, value) => {
      clearTimeout(timer)
      try { ws.close() } catch { /* best effort */ }
      if (error) reject(error)
      else resolve(value)
    }
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.addEventListener('error', () => finish(new Error(`Falha de ligação CDP em ${method}`)))
    ws.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.id !== 1) return
      if (message.error) finish(new Error(`CDP ${method}: ${message.error.message || 'erro'}`))
      else finish(undefined, message.result || {})
    })
  })
}

function trustedCallbackURL(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' && (url.hostname === CHATGPT_HOST || url.hostname.endsWith(`.${CHATGPT_HOST}`)) && !url.pathname.startsWith('/auth')
  } catch { return false }
}

async function authenticatedTarget(port) {
  const targets = await fetchJSON(`http://127.0.0.1:${port}/json/list`)
  const pages = Array.isArray(targets) ? targets.filter((target) => target?.type === 'page' && trustedCallbackURL(target.url) && target.webSocketDebuggerUrl) : []
  for (const target of pages) {
    try {
      const evaluated = await cdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: `(async()=>{try{const r=await fetch('/api/auth/session',{credentials:'include',cache:'no-store'});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return {ok:r.ok,authenticated:Boolean(j&&(j.user||j.accessToken||j.expires))}}catch{return {ok:false,authenticated:false}}})()`,
        awaitPromise: true,
        returnByValue: true,
      })
      if (evaluated?.result?.value?.authenticated) return target
      const cookieResult = await cdpCommand(target.webSocketDebuggerUrl, 'Network.getAllCookies')
      if (hasAuthenticatedSessionCookie(cookieResult.cookies)) return target
    } catch { /* keep polling other targets */ }
  }
  return undefined
}

export async function launchManagedBrowserAuth({ profileDir, loginURL, timeoutMs = DEFAULT_TIMEOUT_MS, onReady } = {}) {
  const executable = resolveManagedBrowserExecutable()
  if (!executable) throw new Error('Chrome/Chromium/Brave não encontrado. Defina WHARNESS_BROWSER_EXECUTABLE com o caminho do navegador.')
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  const port = await reserveLoopbackPort()
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    String(loginURL),
  ]
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: false })
  let closed = false
  let spawnError
  child.once('error', (error) => { spawnError = error; closed = true })
  child.once('exit', () => { closed = true })
  const startedAt = Date.now()
  let version
  while (!version) {
    if (spawnError) throw new Error(`Não foi possível iniciar o navegador externo: ${spawnError.message}`)
    if (closed) throw new Error('O navegador externo foi fechado antes de iniciar a autenticação.')
    if (Date.now() - startedAt > 15_000) throw new Error('O navegador externo não disponibilizou o callback local a tempo.')
    try { version = await fetchJSON(`http://127.0.0.1:${port}/json/version`) } catch { await new Promise((resolve) => setTimeout(resolve, 200)) }
  }
  onReady?.({ executable, port, child })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (closed) throw new Error('O navegador externo foi fechado antes de concluir o login.')
    try {
      const target = await authenticatedTarget(port)
      if (target) {
        const cookiesResult = await cdpCommand(target.webSocketDebuggerUrl, 'Network.getAllCookies')
        const cookies = (cookiesResult.cookies || []).filter(isChatGPTCookie)
        if (!cookies.length) throw new Error('O callback foi recebido, mas a sessão ChatGPT não expôs cookies transferíveis.')
        return { child, port, callbackURL: target.url, cookies, browser: version.Browser || '' }
      }
    } catch { /* transient DevTools/navigation failure */ }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  throw new Error('Tempo limite excedido à espera do callback de autenticação do ChatGPT.')
}

export async function closeManagedBrowserAuth(record) {
  if (!record) return
  try {
    const version = await fetchJSON(`http://127.0.0.1:${record.port}/json/version`)
    if (version?.webSocketDebuggerUrl) await cdpCommand(version.webSocketDebuggerUrl, 'Browser.close', {}, 1500)
  } catch { /* browser may already be gone */ }
  try { record.child?.kill?.('SIGTERM') } catch { /* best effort */ }
}
