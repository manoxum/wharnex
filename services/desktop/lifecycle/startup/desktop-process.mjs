import path from 'node:path'
import { registerDesktopFocusSignal } from './focus-signal.mjs'

export function configureDesktopProcess({ app, BrowserWindow, environment, platform, processTarget, logger, getMainWindow }) {
  // Some Linux networks advertise IPv6 while dropping HTTPS connections on
  // that route. Keep Chromium on the verified IPv4 path until the host is fixed.
  app.commandLine.appendSwitch('disable-ipv6')
  // Electron's GPU path has trapped while composing the local shell and remote
  // surfaces on Linux/X11. Software compositing keeps the workspace stable.
  if (platform === 'linux') app.disableHardwareAcceleration()

  // Record asynchronous faults without closing every open desktop window.
  processTarget.on('uncaughtException', (error) => {
    logger.error('[main-process-fault] uncaughtException', error)
  })
  processTarget.on('unhandledRejection', (reason) => {
    logger.error('[main-process-fault] unhandledRejection', reason)
  })

  // Separate checkouts need separate Chromium profiles to avoid shared LevelDB
  // state. The shipped environment variable is retained for compatibility.
  const customUserDataDir = String(environment.WHARNESS_DESKTOP_USER_DATA_DIR || '').trim()
  if (customUserDataDir) {
    if (!path.isAbsolute(customUserDataDir)) throw new Error('WHARNESS_DESKTOP_USER_DATA_DIR must be an absolute path')
    app.setPath('userData', path.normalize(customUserDataDir))
  }

  // A second process must hand off instead of opening the same profile twice.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    const showDesktop = () => {
      // The browser host is a one-pixel, unfocusable window; never raise it.
      const main = getMainWindow()
      const win = main && main.isDestroyed?.() !== true ? main : BrowserWindow.getAllWindows().find((candidate) => candidate.isFocusable?.() !== false)
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    app.on('second-instance', showDesktop)
    if (platform === 'linux') registerDesktopFocusSignal({
      processTarget, runtimeDir: environment.WHARNESS_RUNTIME_DIR, showDesktop,
    })
  }
}
