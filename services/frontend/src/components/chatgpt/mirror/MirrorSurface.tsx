import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'

type Frame = { url: string; width: number; height: number }
type MouseButton = NonNullable<DesktopMirrorInput['button']>

const BUTTONS: MouseButton[] = ['left', 'middle', 'right']

function modifiers(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

// The real ChatGPT view lives in the browser monitor window; this shows its
// live frames and forwards the user's own pointer and keys back to it.
export function MirrorSurface({ subscribe, send, label }: {
  subscribe: (callback: (frame: DesktopMirrorFrame) => void) => () => void
  send: (input: DesktopMirrorInput) => Promise<unknown>
  label: string
}) {
  const [frame, setFrame] = useState<Frame>()
  const surface = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const moving = useRef(0)

  useEffect(() => {
    let current = ''
    const off = subscribe((next) => {
      const url = URL.createObjectURL(new Blob([next.data], { type: 'image/jpeg' }))
      if (current) URL.revokeObjectURL(current)
      current = url
      setFrame({ url, width: next.width, height: next.height })
    })
    return () => { off(); if (current) URL.revokeObjectURL(current); cancelAnimationFrame(moving.current) }
  }, [subscribe])

  // Normalised to the drawn image, which object-contain may letterbox.
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = image.current?.getBoundingClientRect()
    if (!rect || !frame) return undefined
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height)
    const width = frame.width * scale
    const height = frame.height * scale
    const nx = (event.clientX - rect.left - (rect.width - width) / 2) / width
    const ny = (event.clientY - rect.top - (rect.height - height) / 2) / height
    return { nx: Math.min(1, Math.max(0, nx)), ny: Math.min(1, Math.max(0, ny)) }
  }

  const forward = (input: DesktopMirrorInput) => { void send(input).catch(() => undefined) }

  const mouse = (type: DesktopMirrorInput['type'], event: MouseEvent<HTMLDivElement>) => {
    const at = point(event)
    if (!at) return
    forward({ type, ...at, modifiers: modifiers(event), button: type === 'mouseMoved' ? 'none' : BUTTONS[event.button] || 'left', buttons: event.buttons, clickCount: type === 'mouseMoved' ? 0 : Math.max(1, event.detail || 1) })
  }

  const move = (event: MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY, buttons, altKey, ctrlKey, metaKey, shiftKey } = event
    cancelAnimationFrame(moving.current)
    moving.current = requestAnimationFrame(() => {
      const at = point({ clientX, clientY })
      if (at) forward({ type: 'mouseMoved', ...at, modifiers: modifiers({ altKey, ctrlKey, metaKey, shiftKey }), button: 'none', buttons, clickCount: 0 })
    })
  }

  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    const at = point(event)
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1
    if (at) forward({ type: 'mouseWheel', ...at, modifiers: modifiers(event), button: 'none', buttons: 0, clickCount: 0, deltaX: event.deltaX * unit, deltaY: event.deltaY * unit })
  }

  const key = (type: 'keyDown' | 'keyUp', event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    forward({ type, key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifiers(event) })
  }

  return <div ref={surface} className="desktop-chatgpt-mirror" tabIndex={0} role="application" aria-label={label}
    onMouseDown={(event) => { surface.current?.focus(); event.preventDefault(); mouse('mousePressed', event) }}
    onMouseUp={(event) => mouse('mouseReleased', event)}
    onMouseMove={move}
    onWheel={wheel}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => key('keyDown', event)}
    onKeyUp={(event) => key('keyUp', event)}>
    {frame ? <img ref={image} src={frame.url} alt="" draggable={false} /> : <span className="desktop-chatgpt-mirror-waiting">A ligar ao navegador…</span>}
  </div>
}
