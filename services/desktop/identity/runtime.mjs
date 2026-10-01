import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { desktopInstanceName } from './desktop-identity.mjs'
import { desktopIconDataURL } from '../icon/desktop-icon-mark.mjs'
import {
  createOperationalLogShipper, installConsoleCapture, currentTrace,
  installBackendTraceHeader,
} from '../observability/index.mjs'

export function initializeDesktopIdentity({ app, nativeImage, environment, consoleTarget, globalTarget, requireLocalHTTPURL }) {
  const DESKTOP_INSTANCE = environment.WHARNESS_INSTANCE_ID
  const slug = desktopInstanceName(DESKTOP_INSTANCE).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wharnex'
  const dataHome = environment.WHARNESS_DESKTOP_DATA_HOME || path.join(homedir(), '.local', 'share')
  let DESKTOP_ICON
  for (const candidate of [
    path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps', `wharnex-${slug}.png`),
    path.join(dataHome, 'icons', 'hicolor', 'scalable', 'apps', `wharnex-${slug}.svg`),
  ]) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) { DESKTOP_ICON = image; break }
  }
  DESKTOP_ICON ||= nativeImage.createFromDataURL(desktopIconDataURL(256, DESKTOP_INSTANCE))
  app.setName(`Wharnex - ${desktopInstanceName(DESKTOP_INSTANCE)}`)
  const FRONTEND_URL = requireLocalHTTPURL(environment.WHARNESS_FRONTEND_URL || 'http://127.0.0.1:5173', 'Frontend URL').href
  const BACKEND_URL = requireLocalHTTPURL(environment.WHARNESS_API_URL || 'http://127.0.0.1:8888', 'Backend URL').href
  // Capture logs before composing the rest of the process (adr/ADR-0075).
  const operationalLog = createOperationalLogShipper({ endpoint: new URL('/api/operational-log', BACKEND_URL).href })
  installConsoleCapture(consoleTarget, operationalLog, { trace: currentTrace })
  installBackendTraceHeader(globalTarget, BACKEND_URL)
  app.on('will-quit', () => { void operationalLog.flush() })
  const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
  const FRONTEND_RUNTIME_TOKEN = randomUUID()
  return { DESKTOP_INSTANCE, DESKTOP_ICON, FRONTEND_URL, BACKEND_URL, FRONTEND_ORIGIN, FRONTEND_RUNTIME_TOKEN }
}
