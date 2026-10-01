export function registerClipboardDomainIPC(common, context) {
  const { ipcMain, trustedSender } = common
  const { registerClipboardIPC, clipboard, ClipboardItem, app, fetchContextZip } = context
  registerClipboardIPC({
    ipcMain, trustedSender, clipboard, ClipboardItem, app, fetchContextZip,
  })
}
