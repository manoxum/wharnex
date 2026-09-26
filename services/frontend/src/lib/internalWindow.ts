export const INTERNAL_WINDOW_DOCK_ID = 'wharnex-internal-window-dock'

const INTERNAL_WINDOW_VIEWPORT_MARGIN = 8
const INTERNAL_WINDOW_MIN_WIDTH = 280
const INTERNAL_WINDOW_MIN_HEIGHT = 160
const INTERNAL_WINDOW_INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[data-internal-window-no-drag]',
].join(',')

export function ensureInternalWindowDockRoot() {
  if (typeof document === 'undefined') return null
  let root = document.getElementById(INTERNAL_WINDOW_DOCK_ID)
  if (root) return root
  root = document.createElement('div')
  root.id = INTERNAL_WINDOW_DOCK_ID
  root.className = 'internal-window-dock'
  root.setAttribute('aria-label', 'Janelas minimizadas')
  document.body.appendChild(root)
  return root
}

function directDialogHeader(shell: HTMLElement) {
  const surface = [...shell.children].find((child) => {
    if (!(child instanceof HTMLElement)) return false
    const role = child.getAttribute('role')
    return role === 'dialog' || role === 'alertdialog'
  }) as HTMLElement | undefined
  if (!surface) return undefined
  return [...surface.children].find((child) => child instanceof HTMLElement && child.tagName === 'HEADER') as HTMLElement | undefined
}

function viewportSize() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return { width: 0, height: 0 }
  return {
    width: Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0),
    height: Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0),
  }
}

function clampDragDelta(delta: number, minimum: number, maximum: number) {
  if (minimum > maximum) return 0
  return Math.min(maximum, Math.max(minimum, delta))
}

export function bindInternalWindowDrag(shell: HTMLElement, additionalHandles: Array<HTMLElement | null | undefined> = []) {
  const handles = [directDialogHeader(shell), ...additionalHandles]
    .filter((handle): handle is HTMLElement => Boolean(handle))
    .filter((handle, index, all) => all.indexOf(handle) === index)
  if (!handles.length) return () => undefined

  let offsetX = 0
  let offsetY = 0
  let drag: {
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    rect: DOMRect
    handle: HTMLElement
  } | undefined

  const renderPosition = () => {
    shell.style.transform = `translate3d(${Math.round(offsetX)}px, ${Math.round(offsetY)}px, 0)`
  }

  const finishDrag = (event?: PointerEvent) => {
    if (!drag) return
    const active = drag
    drag = undefined
    shell.removeAttribute('data-internal-window-dragging')
    if (event && active.handle.hasPointerCapture?.(active.pointerId)) active.handle.releasePointerCapture?.(active.pointerId)
  }

  const pointerDown = (event: PointerEvent) => {
    if (drag || event.isPrimary === false || shell.dataset.internalWindowMaximized === 'true') return
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    if (event.button > 0) return
    if (event.target instanceof Element && event.target.closest(INTERNAL_WINDOW_INTERACTIVE_SELECTOR)) return
    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement)) return
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetX,
      originY: offsetY,
      rect: shell.getBoundingClientRect(),
      handle,
    }
    shell.setAttribute('data-internal-window-dragging', 'true')
    handle.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const pointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    const { width, height } = viewportSize()
    const rawX = event.clientX - drag.startX
    const rawY = event.clientY - drag.startY
    const deltaX = width > 0
      ? clampDragDelta(rawX, INTERNAL_WINDOW_VIEWPORT_MARGIN - drag.rect.left, width - INTERNAL_WINDOW_VIEWPORT_MARGIN - drag.rect.right)
      : rawX
    const deltaY = height > 0
      ? clampDragDelta(rawY, INTERNAL_WINDOW_VIEWPORT_MARGIN - drag.rect.top, height - INTERNAL_WINDOW_VIEWPORT_MARGIN - drag.rect.bottom)
      : rawY
    offsetX = drag.originX + deltaX
    offsetY = drag.originY + deltaY
    renderPosition()
    event.preventDefault()
  }

  const pointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    finishDrag(event)
  }

  for (const handle of handles) {
    handle.setAttribute('data-internal-window-drag-handle', 'true')
    handle.addEventListener('pointerdown', pointerDown)
    handle.addEventListener('pointermove', pointerMove)
    handle.addEventListener('pointerup', pointerUp)
    handle.addEventListener('pointercancel', pointerUp)
    handle.addEventListener('lostpointercapture', pointerUp)
  }

  return () => {
    finishDrag()
    for (const handle of handles) {
      handle.removeEventListener('pointerdown', pointerDown)
      handle.removeEventListener('pointermove', pointerMove)
      handle.removeEventListener('pointerup', pointerUp)
      handle.removeEventListener('pointercancel', pointerUp)
      handle.removeEventListener('lostpointercapture', pointerUp)
      if (!additionalHandles.includes(handle)) handle.removeAttribute('data-internal-window-drag-handle')
    }
  }
}


export function bindInternalWindowResize(shell: HTMLElement, handle: HTMLElement | null | undefined) {
  if (!handle) return () => undefined

  let resize: {
    pointerId: number
    startX: number
    startY: number
    width: number
    height: number
  } | undefined

  const finishResize = (event?: PointerEvent) => {
    if (!resize) return
    const pointerId = resize.pointerId
    resize = undefined
    shell.removeAttribute('data-internal-window-resizing')
    if (event && handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture?.(pointerId)
  }

  const pointerDown = (event: PointerEvent) => {
    if (resize || event.isPrimary === false || shell.dataset.internalWindowMaximized === 'true') return
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    if (event.button > 0) return
    const rect = shell.getBoundingClientRect()
    resize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
    }
    shell.style.width = `${Math.round(rect.width)}px`
    shell.style.height = `${Math.round(rect.height)}px`
    shell.setAttribute('data-internal-window-sized', 'true')
    shell.setAttribute('data-internal-window-resizing', 'true')
    handle.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const pointerMove = (event: PointerEvent) => {
    if (!resize || event.pointerId !== resize.pointerId) return
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    const { width: viewportWidth, height: viewportHeight } = viewportSize()
    const maximumWidth = viewportWidth > 0 ? Math.max(INTERNAL_WINDOW_MIN_WIDTH, viewportWidth - INTERNAL_WINDOW_VIEWPORT_MARGIN * 2) : Number.POSITIVE_INFINITY
    const maximumHeight = viewportHeight > 0 ? Math.max(INTERNAL_WINDOW_MIN_HEIGHT, viewportHeight - INTERNAL_WINDOW_VIEWPORT_MARGIN * 2) : Number.POSITIVE_INFINITY
    const minimumWidth = Math.min(INTERNAL_WINDOW_MIN_WIDTH, resize.width)
    const minimumHeight = Math.min(INTERNAL_WINDOW_MIN_HEIGHT, resize.height)
    const nextWidth = Math.min(maximumWidth, Math.max(minimumWidth, resize.width + event.clientX - resize.startX))
    const nextHeight = Math.min(maximumHeight, Math.max(minimumHeight, resize.height + event.clientY - resize.startY))
    shell.style.width = `${Math.round(nextWidth)}px`
    shell.style.height = `${Math.round(nextHeight)}px`
    event.preventDefault()
  }

  const pointerUp = (event: PointerEvent) => {
    if (!resize || event.pointerId !== resize.pointerId) return
    finishResize(event)
  }

  handle.addEventListener('pointerdown', pointerDown)
  handle.addEventListener('pointermove', pointerMove)
  handle.addEventListener('pointerup', pointerUp)
  handle.addEventListener('pointercancel', pointerUp)
  handle.addEventListener('lostpointercapture', pointerUp)

  return () => {
    finishResize()
    handle.removeEventListener('pointerdown', pointerDown)
    handle.removeEventListener('pointermove', pointerMove)
    handle.removeEventListener('pointerup', pointerUp)
    handle.removeEventListener('pointercancel', pointerUp)
    handle.removeEventListener('lostpointercapture', pointerUp)
  }
}
