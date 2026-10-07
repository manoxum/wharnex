import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { desktopIconDataURL } from '../icon/desktop-icon-mark.mjs'

export function splashIdentity(environment = {}, rootName = 'wharnex') {
  // WHARNESS_* remains the installed launcher/profile compatibility boundary.
  const instance = environment.WHARNESS_INSTANCE_ID || rootName
  const slug = String(instance).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wharnex'
  return { instance, desktopName: `wharnex-${slug}.desktop` }
}

export function resolveSplashIcon(nativeImage, environment = {}, rootName = 'wharnex') {
  const { instance, desktopName } = splashIdentity(environment, rootName)
  const dataHome = environment.WHARNESS_DESKTOP_DATA_HOME || `${homedir()}/.local/share`
  const path = `${dataHome}/icons/hicolor/256x256/apps/${desktopName.replace(/\.desktop$/, '.png')}`
  if (existsSync(path)) {
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  // Electron cannot decode SVG: always supply a real PNG, even before installation.
  return nativeImage.createFromDataURL(desktopIconDataURL(256, instance))
}
