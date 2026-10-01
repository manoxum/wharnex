export type HeaderPopoverSource = 'project-list' | 'project-actions' | 'git' | 'appearance' | 'attention' | 'tunnels' | 'settings' | 'workspace-action'

const HEADER_POPOVER_EVENT = 'wharnex:header-popover-open'

export function announceHeaderPopover(source: HeaderPopoverSource) {
  window.dispatchEvent(new CustomEvent<HeaderPopoverSource>(HEADER_POPOVER_EVENT, { detail: source }))
}

export function subscribeHeaderPopover(listener: (source: HeaderPopoverSource) => void) {
  const handler = (event: Event) => {
    const source = (event as CustomEvent<HeaderPopoverSource>).detail
    if (source) listener(source)
  }
  window.addEventListener(HEADER_POPOVER_EVENT, handler)
  return () => window.removeEventListener(HEADER_POPOVER_EVENT, handler)
}

export function subscribeOtherHeaderPopover(source: HeaderPopoverSource, close: () => void) {
  return subscribeHeaderPopover((next) => { if (next !== source) close() })
}
