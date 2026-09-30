import type { Terminal } from '@xterm/xterm'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'

export function terminalClipboardShortcut(terminal: Terminal, reportError: (error: unknown) => void, isActive: () => boolean) {
  return (event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    const copy = key === 'c' && ((event.ctrlKey && event.shiftKey) || event.metaKey)
    const paste = key === 'v' && ((event.ctrlKey && event.shiftKey) || event.metaKey)
    if (!copy && !paste) return
    event.preventDefault()
    event.stopPropagation()
    const bridge = desktopBridge()
    if (copy) {
      const text = terminal.getSelection()
      if (!text) return
      if (bridge) void bridge.clipboard.writeText(text).catch(reportError)
      else if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(reportError)
      return
    }
    const read = bridge?.clipboard.readText ? bridge.clipboard.readText() : navigator.clipboard?.readText?.()
    if (read) void read.then((text) => { if (isActive() && text) terminal.paste(text) }).catch(reportError)
  }
}
