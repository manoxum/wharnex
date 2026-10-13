export function registerNativeShutdown(app, runtime) {
  let quitting = false, stopping
  app.on('before-quit', (event) => {
    const engine = runtime()
    if (!engine || quitting) return
    event.preventDefault()
    stopping ||= Promise.resolve().then(() => engine.close()).catch(() => console.warn('[codex] native shutdown failed')).finally(() => { quitting = true; app.quit() })
  })
}
