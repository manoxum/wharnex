import path from 'node:path'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { notifyChatGPTAccountChanged } from '../../chatgpt/session/health/account-change.mjs'

// Legacy names here identify existing on-disk archives and temporary paths.
const TEMP_DATA_NAMES = ['wharness-bundles', 'wharness-plans', 'wharness-context', 'wharness-chat-inputs', 'wharness-chat-protocol']

export function createBrowserSessionOperations({
  app, session, dialog, partition, partitionPath, authProfilePath,
  pendingImportPath, attachmentRoot, closeViews, closeInternalBrowsers,
  closeManagedAuth, authBrowsers, preparedDrafts, retryablePrompts,
  expectedBundles, clearRecentDownload, snapshot, restore, size,
  closeOwnedBrowser = () => {}, ownedBrowserProfilePath,
}) {
  async function exportSession(windowState) {
    const chatSession = session.fromPartition(partition)
    await chatSession.flushStorageData()
    closeViews()
    closeInternalBrowsers()
    const archive = await snapshot(partitionPath())
    const result = await dialog.showSaveDialog(windowState?.window, {
      title: 'Exportar sessão do navegador Wharnex',
      defaultPath: path.join(app.getPath('downloads'), `wharness-browser-session-${new Date().toISOString().slice(0, 10)}.whbs`),
      filters: [{ name: 'Wharnex Browser Session', extensions: ['whbs'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true }
    await writeFile(result.filePath, archive, { mode: 0o600 })
    return { cancelled: false, bytes: archive.byteLength, filename: path.basename(result.filePath) }
  }

  async function importSession(windowState) {
    const result = await dialog.showOpenDialog(windowState?.window, {
      title: 'Importar sessão do navegador Wharnex',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Wharnex Browser Session', extensions: ['whbs'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    const raw = await readFile(result.filePaths[0])
    const validationRoot = path.join(app.getPath('temp'), `wharness-browser-import-${process.pid}`)
    const restored = await restore(validationRoot, raw)
    await rm(validationRoot, { recursive: true, force: true })
    await writeFile(pendingImportPath(), raw, { mode: 0o600 })
    notifyChatGPTAccountChanged('session-imported')
    closeViews()
    closeInternalBrowsers()
    setTimeout(() => { app.relaunch(); app.exit(0) }, 500)
    return { cancelled: false, restarting: true, ...restored }
  }

  async function applyPendingImport() {
    let raw
    try { raw = await readFile(pendingImportPath()) } catch { return false }
    await restore(partitionPath(), raw)
    await rm(pendingImportPath(), { force: true })
    console.log('[chatgpt-session] imported browser session before partition startup')
    return true
  }

  async function clearSession() {
    const records = [...authBrowsers.values()]
    closeViews()
    closeInternalBrowsers()
    for (const record of records) await closeManagedAuth(record)
    closeOwnedBrowser()
    preparedDrafts.clear()
    retryablePrompts.clear()
    expectedBundles.clear()
    clearRecentDownload()
    const chatSession = session.fromPartition(partition)
    await chatSession.clearStorageData()
    await chatSession.clearCache()
    await chatSession.flushStorageData()
    await rm(authProfilePath(), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    notifyChatGPTAccountChanged('session-cleared')
    if (ownedBrowserProfilePath) await rm(ownedBrowserProfilePath(), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    return { ok: true }
  }

  async function storageUsage() {
    const userData = app.getPath('userData')
    const browserBytes = await size(partitionPath()) + await size(authProfilePath())
      + (ownedBrowserProfilePath ? await size(ownedBrowserProfilePath()) : 0)
    const attachmentBytes = await size(attachmentRoot())
    let tempBytes = 0
    let entries = []
    try { entries = await readdir(app.getPath('temp'), { withFileTypes: true }) } catch { /* best effort */ }
    for (const entry of entries) {
      if (!entry.isDirectory() || !TEMP_DATA_NAMES.includes(entry.name)) continue
      tempBytes += await size(path.join(app.getPath('temp'), entry.name))
    }
    const userDataBytes = await size(userData)
    return { total_bytes: userDataBytes + tempBytes, user_data_bytes: userDataBytes, browser_bytes: browserBytes, attachment_bytes: attachmentBytes, temp_bytes: tempBytes, other_user_data_bytes: Math.max(0, userDataBytes - browserBytes - attachmentBytes) }
  }

  async function clearDesktopData() {
    await clearSession()
    const localSession = session.defaultSession
    await localSession.clearStorageData()
    await localSession.clearCache()
    await localSession.flushStorageData()
    await rm(attachmentRoot(), { recursive: true, force: true })
    await rm(pendingImportPath(), { force: true })
    for (const name of TEMP_DATA_NAMES) await rm(path.join(app.getPath('temp'), name), { recursive: true, force: true })
    return { ok: true }
  }

  return { exportSession, importSession, applyPendingImport, clearSession, storageUsage, clearDesktopData }
}
