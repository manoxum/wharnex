export function registerBrowserDataIPC({
  ipcMain, trustedSender, desktopStorageUsage, exportBrowserSession,
  importBrowserSession, clearBrowserSession, clearDesktopWharnexData,
}) {
  ipcMain.handle('wharness:data:storage', async (event) => { trustedSender(event); return desktopStorageUsage() })
  ipcMain.handle('wharness:data:export-browser-session', async (event) => {
    const windowState = trustedSender(event)
    return exportBrowserSession(windowState)
  })
  ipcMain.handle('wharness:data:import-browser-session', async (event) => {
    const windowState = trustedSender(event)
    return importBrowserSession(windowState)
  })
  ipcMain.handle('wharness:data:clear-browser-session', async (event) => {
    trustedSender(event)
    return clearBrowserSession()
  })
  ipcMain.handle('wharness:data:clear-all', async (event, request) => {
    trustedSender(event)
    if (String(request?.confirm || '').trim() !== 'APAGAR WHARNEX') throw new Error('Complete Wharnex reset confirmation mismatch')
    return clearDesktopWharnexData()
  })
}
