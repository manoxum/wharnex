import { desktopBridge } from '../../desktop/bridge/desktop'
import { applySystemLanguages } from './locale'
export async function initializeSystemLanguages() {
  try {
    const info = await desktopBridge()?.windows.info()
    if (info?.systemLanguages) applySystemLanguages(info.systemLanguages)
  } catch { /* Browser-only clients and older Desktop hosts keep navigator.languages. */ }
}
