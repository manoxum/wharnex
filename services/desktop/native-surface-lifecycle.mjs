function navigationFields(details, legacyUrl, legacyIsInPlace, legacyIsMainFrame) {
  if (details && typeof details === 'object' && typeof details.url === 'string') {
    return { url: details.url, isSameDocument: Boolean(details.isSameDocument), isMainFrame: Boolean(details.isMainFrame) }
  }
  return { url: legacyUrl, isSameDocument: Boolean(legacyIsInPlace), isMainFrame: Boolean(legacyIsMainFrame) }
}

export function shouldSuspendNativeSurfacesForNavigation(url, { frontendOrigin, isSameDocument, isMainFrame } = {}) {
  if (!isMainFrame || isSameDocument || !frontendOrigin) return false
  try { return new URL(url).origin === frontendOrigin } catch { return false }
}

export function installNativeSurfaceLifecycleGuard(webContents, { frontendOrigin, suspend } = {}) {
  if (!webContents?.on || typeof suspend !== 'function') throw new Error('Native surface lifecycle guard requires webContents and suspend')
  const onNavigation = (details, legacyUrl, legacyIsInPlace, legacyIsMainFrame) => {
    const navigation = navigationFields(details, legacyUrl, legacyIsInPlace, legacyIsMainFrame)
    if (shouldSuspendNativeSurfacesForNavigation(navigation.url, { frontendOrigin, ...navigation })) suspend('renderer-navigation')
  }
  const onRendererGone = () => suspend('renderer-gone')
  webContents.on('did-start-navigation', onNavigation)
  webContents.on('render-process-gone', onRendererGone)
  return () => {
    webContents.removeListener?.('did-start-navigation', onNavigation)
    webContents.removeListener?.('render-process-gone', onRendererGone)
  }
}
