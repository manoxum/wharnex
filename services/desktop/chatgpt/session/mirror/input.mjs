const DEBUGGER_IDLE_MS = 10_000
const MOUSE_TYPES = new Set(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'])
const KEY_TYPES = new Set(['keyDown', 'keyUp'])
const BUTTONS = new Set(['none', 'left', 'middle', 'right'])
const EDIT_COMMANDS = Object.freeze({ a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo', y: 'redo' })

const bounded = (value, min, max, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

// The only input a project mirror may forward: one pointer, wheel or key event
// the local user produced on that mirror, in a closed vocabulary. Coordinates
// arrive normalised to the mirrored image so no page geometry crosses IPC.
export function sanitizeMirrorInput(raw) {
  const type = String(raw?.type || '')
  const modifiers = Math.floor(bounded(raw?.modifiers, 0, 15))
  if (MOUSE_TYPES.has(type)) {
    const button = BUTTONS.has(raw?.button) ? raw.button : 'none'
    return {
      type, modifiers, button,
      nx: bounded(raw?.nx, 0, 1), ny: bounded(raw?.ny, 0, 1),
      buttons: Math.floor(bounded(raw?.buttons, 0, 7)),
      clickCount: Math.floor(bounded(raw?.clickCount, 0, 3)),
      deltaX: bounded(raw?.deltaX, -5000, 5000), deltaY: bounded(raw?.deltaY, -5000, 5000),
    }
  }
  if (KEY_TYPES.has(type)) {
    const key = String(raw?.key || '')
    const code = String(raw?.code || '')
    if (!key || key.length > 40 || !/^[A-Za-z0-9]{0,40}$/.test(code)) throw new Error('Tecla inválida')
    return { type, modifiers, key, code, keyCode: Math.floor(bounded(raw?.keyCode, 0, 255)) }
  }
  throw new Error('Evento de input inválido')
}

// Text a key produces is derived here, never taken from the renderer.
function keyText(input) {
  if (input.modifiers & (2 | 4)) return ''
  if (input.key === 'Enter') return '\r'
  return [...input.key].length === 1 ? input.key : ''
}

function editCommands(input) {
  if (!(input.modifiers & (2 | 4))) return undefined
  const letter = input.key.toLowerCase()
  if (letter === 'z' && input.modifiers & 8) return ['redo']
  return EDIT_COMMANDS[letter] ? [EDIT_COMMANDS[letter]] : undefined
}

const sessions = new WeakMap()

// Delivered over the WebContents debugger, like hidden-surface automation: a
// view that is not composited silently drops sendInputEvent pointer presses.
async function withDebugger(wc, action) {
  let session = sessions.get(wc)
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach('1.3')
    session = { ownsAttachment: true, timer: undefined }
    sessions.set(wc, session)
  } else if (!session) {
    session = { ownsAttachment: false, timer: undefined }
    sessions.set(wc, session)
  }
  clearTimeout(session.timer)
  try {
    return await action((method, params) => wc.debugger.sendCommand(method, params))
  } finally {
    session.timer = setTimeout(() => {
      sessions.delete(wc)
      if (session.ownsAttachment && !wc.isDestroyed() && wc.debugger.isAttached()) {
        void wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined)
          .finally(() => { try { wc.debugger.detach() } catch { /* already detached */ } })
      }
    }, DEBUGGER_IDLE_MS)
    session.timer.unref?.()
  }
}

export async function dispatchMirrorInput(entry, raw) {
  const input = sanitizeMirrorInput(raw)
  const wc = entry?.view?.webContents
  if (!wc || wc.isDestroyed()) throw new Error('Instância do navegador indisponível')
  const native = entry.view.native || entry.view
  const size = native.getBounds()
  const zoom = Number(wc.getZoomFactor?.()) || 1
  await withDebugger(wc, async (send) => {
    if (input.type === 'mousePressed' || input.type === 'keyDown') await send('Emulation.setFocusEmulationEnabled', { enabled: true })
    if (MOUSE_TYPES.has(input.type)) {
      await send('Input.dispatchMouseEvent', {
        type: input.type,
        x: (input.nx * size.width) / zoom, y: (input.ny * size.height) / zoom,
        button: input.button, buttons: input.buttons, clickCount: input.clickCount, modifiers: input.modifiers,
        ...(input.type === 'mouseWheel' ? { deltaX: input.deltaX, deltaY: input.deltaY } : {}),
      })
      return
    }
    const text = input.type === 'keyDown' ? keyText(input) : ''
    const commands = input.type === 'keyDown' ? editCommands(input) : undefined
    await send('Input.dispatchKeyEvent', {
      type: input.type === 'keyUp' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
      key: input.key, code: input.code, modifiers: input.modifiers,
      windowsVirtualKeyCode: input.keyCode, nativeVirtualKeyCode: input.keyCode,
      ...(text ? { text, unmodifiedText: text } : {}),
      ...(commands ? { commands } : {}),
    })
  })
  return { ok: true }
}
