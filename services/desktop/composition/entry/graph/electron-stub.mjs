// An inert stand-in for the Electron main-process API, enough to compose the
// Desktop outside Electron. Every member is a callable, constructible proxy;
// `app.whenReady()` never settles, so nothing starts.
function inert(name) {
  return new Proxy(function stub() {}, {
    get(_target, property) {
      if (property === 'then') return undefined
      if (property === Symbol.toPrimitive) return () => ''
      if (property === Symbol.iterator) return function* empty() {}
      if (property === 'whenReady') return () => new Promise(() => {})
      if (property === 'getPath') return () => '/nonexistent/wharnex-composition-probe'
      if (property === 'getAllDisplays') return () => []
      return inert(`${name}.${String(property)}`)
    },
    apply: () => inert(`${name}()`),
    construct: () => inert(`new ${name}`),
  })
}

export const app = inert('app')
export const BrowserWindow = inert('BrowserWindow')
export const ClipboardItem = inert('ClipboardItem')
export const Menu = inert('Menu')
export const MessageChannelMain = inert('MessageChannelMain')
export const Notification = inert('Notification')
export const Tray = inert('Tray')
export const View = inert('View')
export const WebContentsView = inert('WebContentsView')
export const clipboard = inert('clipboard')
export const dialog = inert('dialog')
export const ipcMain = inert('ipcMain')
export const nativeImage = inert('nativeImage')
export const screen = inert('screen')
export const session = inert('session')
export const shell = inert('shell')
export default inert('electron')
