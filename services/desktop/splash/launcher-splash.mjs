import { app, BrowserWindow, nativeImage, clipboard } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { readProjectVersion } from './splash-version.mjs'

import { basename, resolve } from 'node:path'
import { resolveSplashIcon, splashIdentity } from './splash-icon.mjs'
import { createSplashOutputReader, copySplashOutput } from './output/index.mjs'
import { splashPage } from './view/index.mjs'
import { COLLAPSED_HEIGHT, SPLASH_WIDTH, resizeSplashWindow } from './window/index.mjs'

const rootName = basename(process.env.WHARNESS_ROOT || resolve(import.meta.dirname, '../../..'))
const SPLASH_ICON = resolveSplashIcon(nativeImage, process.env, rootName)
const identity = splashIdentity(process.env, rootName)
if (process.platform === 'linux') app.setDesktopName(identity.desktopName)
const page = splashPage(readProjectVersion())
const statusFile = process.env.WHARNESS_SPLASH_STATUS_FILE || ''
const readyFile = process.env.WHARNESS_SPLASH_READY_FILE || ''
const outputFile = process.env.WHARNEX_SPLASH_OUTPUT_FILE || ''
const failureFile = statusFile ? `${statusFile}.failed` : ''
const readOutput = createSplashOutputReader({ outputFile, desktopFile: process.env.WHARNEX_SPLASH_DESKTOP_LOG_FILE })
let splash
let timer
let rendered = 0
let updating = false

function readStatus() {
  try { return readFileSync(statusFile, 'utf8').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) || 'A preparar o espaço de trabalho…' }
  catch { return 'A preparar o espaço de trabalho…' }
}

app.whenReady().then(async () => {
  splash = new BrowserWindow({
    width: SPLASH_WIDTH, height: COLLAPSED_HEIGHT, show: false, frame: false, resizable: false,
    transparent: false, alwaysOnTop: true, skipTaskbar: false, backgroundColor: '#111310',
    title: 'Wharnex · Arranque', icon: SPLASH_ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  splash.setMenuBarVisibility(false)
  splash.once('ready-to-show', () => {
    splash.showInactive()
    if (readyFile) writeFileSync(readyFile, 'ready\n', { mode: 0o600 })
  })
  await splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  timer = setInterval(() => {
    if (splash?.isDestroyed() || updating) return
    updating = true
    const history = readOutput()
    const entries = history.slice(rendered, rendered + 250)
    const state = { status: readStatus(), entries, latest: history.at(-1), append: true, from: rendered, failed: Boolean(failureFile && existsSync(failureFile)) }
    void splash.webContents.executeJavaScript(`window.setSplashState(${JSON.stringify(state)})`).then((action) => {
      if (!splash || splash.isDestroyed() || !action || typeof action !== 'object') return
      rendered += entries.length
      resizeSplashWindow(splash, action.collapsed)
      if (action.copy === true) {
        const copied = copySplashOutput(clipboard, readOutput({ drain: true }))
        void splash.webContents.executeJavaScript(`window.setCopyResult(${copied})`).catch(() => {})
      }
    }).catch(() => {}).finally(() => { updating = false })
  }, 180)
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  clearInterval(timer)
  for (const file of [statusFile, readyFile, failureFile, outputFile, outputFile && `${outputFile}.next`]) {
    if (file) { try { rmSync(file, { force: true }) } catch { /* launcher also owns cleanup */ } }
  }
})
