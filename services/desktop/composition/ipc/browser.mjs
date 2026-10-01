export function registerBrowserDomainIPC(common, context) {
  const { ipcMain, trustedSender } = common
  const {
    registerBrowserDataIPC, desktopStorageUsage, exportBrowserSession,
    importBrowserSession, clearBrowserSession, clearDesktopWharnexData,
  } = context
  registerBrowserDataIPC({
    ipcMain, trustedSender, desktopStorageUsage, exportBrowserSession,
    importBrowserSession, clearBrowserSession, clearDesktopWharnexData,
  })
}
