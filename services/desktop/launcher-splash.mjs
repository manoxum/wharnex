import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'

const statusFile = process.env.WHARNESS_SPLASH_STATUS_FILE || ''
const readyFile = process.env.WHARNESS_SPLASH_READY_FILE || ''
let splash

function readStatus() {
  try { return readFileSync(statusFile, 'utf8').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) || 'A preparar o espaço de trabalho…' }
  catch { return 'A preparar o espaço de trabalho…' }
}

const page = `<!doctype html><html lang="pt"><meta charset="utf-8"><style>
  *{box-sizing:border-box} html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111310;color:#f5f7ef}
  body{font-family:Manrope,"Segoe UI Variable",sans-serif;display:grid;place-items:center}
  main{width:100%;height:100%;position:relative;overflow:hidden;padding:30px 34px;background:radial-gradient(circle at 89% 12%,#28311b 0,transparent 32%),radial-gradient(circle at 6% 108%,#1e2518 0,transparent 38%),#111310}
  .grain{position:absolute;inset:0;opacity:.22;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E");pointer-events:none}
  header{position:relative;z-index:1;display:flex;align-items:center;gap:10px;font:600 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:#dce4cd}
  .mark{width:30px;height:30px;position:relative;border:1px solid #4a5540;border-radius:9px;background:#171a15;box-shadow:inset 0 1px rgba(255,255,255,.08)}
  .mark:before,.mark:after{content:"";position:absolute;inset:5px;border:2px dashed #b9ff56;border-radius:50%;animation:orbit 4s linear infinite}.mark:after{inset:9px;border-width:2px;animation-direction:reverse;animation-duration:2.7s}.core{position:absolute;inset:12px;border-radius:50%;background:#b9ff56;box-shadow:0 0 16px #b9ff5688}
  .content{position:relative;z-index:1;display:grid;align-content:end;height:calc(100% - 30px);padding-bottom:3px}.eyebrow{font:600 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#b9ff56}.title{margin:12px 0 14px;font-size:38px;line-height:.97;letter-spacing:-.055em;font-weight:650}.status{min-height:42px;max-width:420px;color:#b8bdb2;font-size:14px;line-height:1.5}.rail{height:2px;margin-top:25px;background:#30362b;overflow:hidden}.rail i{display:block;width:34%;height:100%;background:#b9ff56;box-shadow:0 0 18px #b9ff56;animation:travel 1.45s ease-in-out infinite}.meta{position:absolute;right:34px;bottom:34px;color:#798173;font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:right}@keyframes orbit{to{transform:rotate(360deg)}}@keyframes travel{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
</style><body><main><div class="grain"></div><header><span class="mark"><span class="core"></span></span>Wharnex <span style="opacity:.45">/</span> Desktop</header><section class="content"><div class="eyebrow">Arranque seguro</div><h1 class="title">A montar<br>o teu espaço.</h1><div class="status" id="status">A preparar o espaço de trabalho…</div><div class="rail"><i></i></div></section><div class="meta">PROTECTED WORKSPACE<br>LOCAL DESKTOP</div></main><script>window.setStatus=(value)=>{document.getElementById('status').textContent=value}</script></body></html>`

app.whenReady().then(async () => {
  splash = new BrowserWindow({
    width: 570, height: 350, show: false, frame: false, resizable: false,
    transparent: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#111310',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  splash.setMenuBarVisibility(false)
  await splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  splash.once('ready-to-show', () => {
    splash.showInactive()
    if (readyFile) writeFileSync(readyFile, 'ready\n', { mode: 0o600 })
  })
  setInterval(() => {
    if (!splash?.isDestroyed()) void splash.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(readStatus())})`, true)
  }, 180)
})

app.on('window-all-closed', () => app.quit())
