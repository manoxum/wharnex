const COMPOSITOR_DEADLINE_MS = 1200
const RENDERER_DEADLINE_MS = 5000

async function withinDeadline(operation, durationMs, stage) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} excedeu ${durationMs} ms`)), durationMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// The compositor can wait forever for a frame from a parked WebContentsView.
// Rasterizing its existing renderer leaves the automation viewport unchanged.
export async function captureChatGPTAgentPage(wc, { parked = false, compositorDeadlineMs = COMPOSITOR_DEADLINE_MS, rendererDeadlineMs = RENDERER_DEADLINE_MS } = {}) {
  if (!parked) {
    try {
      const image = await withinDeadline(() => wc.capturePage(undefined, { stayHidden: true }), compositorDeadlineMs, 'Captura do compositor')
      if (!image?.isEmpty?.()) {
        const dataUrl = image?.toDataURL?.()
        if (dataUrl) return dataUrl
      }
    } catch { /* fall through to renderer capture */ }
  }

  const attachedHere = !wc.debugger.isAttached()
  if (attachedHere) wc.debugger.attach('1.3')
  try {
    const shot = await withinDeadline(() => wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png', fromSurface: false, captureBeyondViewport: false,
    }), rendererDeadlineMs, 'Captura do renderer')
    if (!shot?.data) throw new Error('O renderer não devolveu imagem')
    return `data:image/png;base64,${shot.data}`
  } finally {
    if (attachedHere) try { wc.debugger.detach() } catch { /* already detached */ }
  }
}
