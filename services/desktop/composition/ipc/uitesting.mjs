export function registerUITestingDomainIPC(common, context) {
  const { ipcMain, trustedSender } = common
  const { registerUITestingGuideIPC, shell, backendURL } = context
  registerUITestingGuideIPC({
    ipcMain, trustedSender, shell, backendURL,
  })
}
