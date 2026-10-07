// Prints the engine-rendered guide page to PDF. The backend composes the page
// (the same one shown in the app and opened in a browser) with captures
// referenced by name; this module only writes it beside those captures in the
// task's private directory and asks Chromium to print it.

const CAPTURE_NAME = /^step-[0-9]{2}\.png$/
const PRINT_SETTLE_MS = 400

export async function printGuidePDF({ BrowserWindow, path, mkdir, writeFile, wait }, dir, html, screenshots) {
  const root = path.join(dir, 'guide-print')
  await mkdir(root, { recursive:true, mode:0o700 })
  for (const shot of screenshots) {
    if (CAPTURE_NAME.test(shot.name)) await writeFile(path.join(root, shot.name), Buffer.from(shot.content_base64, 'base64'), { mode:0o600 })
  }
  const page = path.join(root, 'index.html')
  await writeFile(page, html, { mode:0o600 })
  const window = new BrowserWindow({ show:false, width:1240, height:1754, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false } })
  try {
    await window.loadFile(page)
    await window.webContents.executeJavaScript('Promise.all([...document.images].map((img) => img.decode().catch(() => undefined))).then(() => document.fonts.ready).then(() => true)', true).catch(() => undefined)
    await wait(PRINT_SETTLE_MS)
    return await window.webContents.printToPDF({
      printBackground:true, preferCSSPageSize:true, displayHeaderFooter:true, headerTemplate:'<span></span>',
      footerTemplate:'<div style="width:100%;font:8px system-ui,sans-serif;color:#8b93a7;text-align:right;padding:0 14mm"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    })
  } finally { if (!window.isDestroyed()) window.destroy() }
}
