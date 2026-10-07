import { splashStyles } from './styles.mjs'
import { splashRenderer } from './renderer.mjs'

export function splashPage(version = '') {
  const versionMarkup = /^v\d+\.\d+\.\d+\.\d+$/.test(version) ? `<br>VERSION ${version}` : ''
  return `<!doctype html><html lang="pt"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"><title>Wharnex · Arranque</title><style>${splashStyles}</style><body><main>
  <div class="grain"></div><header><span class="mark"><span class="core"></span></span>Wharnex <span style="opacity:.45">/</span> Desktop<button id="close" aria-label="Fechar" title="Fechar">×</button></header>
  <section class="content"><div class="eyebrow" id="phase">Arranque seguro</div><h1 class="title">A montar<br>o teu espaço.</h1><div class="status" id="status" role="status">A preparar o espaço de trabalho…</div><div class="rail"><i></i></div></section>
  <section class="output collapsed" aria-label="Saída do arranque"><div class="output-heading"><span class="output-title">Saída do arranque</span><button type="button" id="copy-output" aria-label="Copiar saída do arranque" title="Copiar saída do arranque" disabled><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9h11v11H9zM5 15H3V3h12v2"/></svg></button><button type="button" class="output-toggle" id="toggle-output" aria-expanded="false" aria-controls="logs" aria-label="Expandir registos de arranque"><svg class="chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button></div><div class="latest-output" id="latest-output" aria-label="Última linha de saída"><span class="time"></span><span class="text">A aguardar saída dos processos…</span></div><div class="logs" id="logs" hidden tabindex="0" aria-label="Registos de arranque"><p class="waiting">A aguardar saída dos processos…</p></div></section>
  <footer><span id="follow-state">A acompanhar a saída em tempo real</span><span>PROTECTED WORKSPACE · LOCAL DESKTOP${versionMarkup}</span></footer>
  </main><script>${splashRenderer}</script></body></html>`
}
