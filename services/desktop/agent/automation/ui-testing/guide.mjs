function escapeHTML(value) { return String(value || '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])) }

export async function renderGuidePDF(BrowserWindow, title, markdown, screenshots) {
  const window = new BrowserWindow({ show:false, width:1100, height:900, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false } })
  try {
    const gallery = screenshots.map((shot, index) => `<figure><img src="data:image/png;base64,${shot.content_base64}"/><figcaption>${index+1}. ${escapeHTML(shot.caption || shot.name)}</figcaption></figure>`).join('')
    const html = `<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;color:#172019;margin:38px}h1{font-size:26px}pre{white-space:pre-wrap;font:13px system-ui;line-height:1.55}figure{break-inside:avoid;margin:28px 0}img{max-width:100%;border:1px solid #ccd5cc;border-radius:10px}figcaption{margin-top:8px;color:#536056}</style><h1>${escapeHTML(title)}</h1><pre>${escapeHTML(markdown)}</pre>${gallery}`
    await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    return await window.webContents.printToPDF({ printBackground:true, pageSize:'A4', margins:{ marginType:'default' } })
  } finally { if (!window.isDestroyed()) window.destroy() }
}
