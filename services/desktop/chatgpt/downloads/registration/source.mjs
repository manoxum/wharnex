export function createChatGPTDownloadSource(internalChatGPTBrowsers) {
  // Human project browsers share the partition but keep ordinary downloads.
  return function chatGPTDownloadIsHumanBrowsing(sourceWebContents) {
    if (!sourceWebContents) return false
    for (const browser of internalChatGPTBrowsers.values()) {
      if (browser.isDestroyed()) continue
      const wc = browser.webContents
      if (sourceWebContents === wc || sourceWebContents.hostWebContents === wc) return true
    }
    return false
  }
}
