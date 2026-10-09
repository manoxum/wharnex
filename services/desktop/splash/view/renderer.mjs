export const splashRenderer = `
(() => {
  const logs = document.getElementById('logs')
  const latest = document.getElementById('latest-output')
  const followState = document.getElementById('follow-state')
  let following = true
  let previous = ''
  let rendered = 0
  let previousLast
  let collapsed = true
  let copyRequested = false
  let copying = false
  let outputAvailable = false
  const copy = document.getElementById('copy-output')
  const copyIcon = copy.querySelector('path')
  const copyFeedback = (state, title) => {
    copy.dataset.state = state; copy.title = title
    copy.setAttribute('aria-description', title)
    copy.setAttribute('aria-busy', String(state === 'copying'))
    copyIcon.setAttribute('d', state === 'success' ? 'm5 12 4 4L19 6' : state === 'error' ? 'M12 4v10M12 19v1' : 'M9 9h11v11H9zM5 15H3V3h12v2')
  }
  copy.addEventListener('click', () => {
    copying = true; copyRequested = true; copy.disabled = true; copyFeedback('copying', 'A copiar…')
  })
  window.setCopyResult = (success) => {
    copying = false; copy.disabled = !outputAvailable
    copyFeedback(success ? 'success' : 'error', success ? 'Saída copiada' : 'Não foi possível copiar · tentar de novo')
    window.setTimeout(() => { if (!copying) copyFeedback('ready', 'Copiar saída do arranque') }, 1600)
  }
  const toggle = document.getElementById('toggle-output')
  toggle.addEventListener('click', () => {
    collapsed = !collapsed
    toggle.setAttribute('aria-expanded', String(!collapsed))
    toggle.setAttribute('aria-label', collapsed ? 'Expandir registos de arranque' : 'Recolher registos de arranque')
    logs.hidden = collapsed
    toggle.closest('.output').classList.toggle('collapsed', collapsed)
    if (!collapsed && following) logs.scrollTop = logs.scrollHeight
  })
  logs.addEventListener('scroll', () => {
    following = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 24
    followState.textContent = following ? 'A acompanhar a saída em tempo real' : 'Desloca para o fim para acompanhar a saída'
  })
  document.getElementById('close').addEventListener('click', () => window.close())
  window.setSplashState = ({ status, entries, latest: latestEntry, append = false, from = 0, failed }) => {
    document.getElementById('status').textContent = status
    document.body.classList.toggle('failed', Boolean(failed))
    document.getElementById('phase').textContent = failed ? 'Falha no arranque · consulta os registos' : 'Arranque seguro'
    const last = latestEntry || entries.at(-1) || (append ? previousLast : undefined)
    previousLast = last
    latest.dataset.stream = last?.stream || ''
    latest.querySelector('.time').textContent = String(last?.at || '').slice(11, 19)
    latest.querySelector('.text').textContent = last ? last.text : 'A aguardar saída dos processos…'
    latest.title = last?.text || ''
    outputAvailable = Boolean(last)
    copy.disabled = copying || !outputAvailable
    const action = { collapsed, copy: copyRequested }
    copyRequested = false
    if (append) {
      entries = entries.slice(Math.max(0, rendered - from))
      if (!entries.length) return action
    } else {
      const signature = JSON.stringify(entries)
      if (signature === previous) return action
      previous = signature
      rendered = 0
    }
    const scroll = logs.scrollTop
    const fragment = document.createDocumentFragment()
    for (const entry of entries) {
      const line = document.createElement('div')
      line.className = 'line'; line.dataset.stream = entry.stream
      for (const [kind, value] of [['time', String(entry.at || '').slice(11, 19)], ['text', entry.text]]) {
        const span = document.createElement('span'); span.className = kind; span.textContent = value
        line.append(span)
      }
      fragment.append(line)
    }
    if (append && rendered) logs.append(fragment)
    else logs.replaceChildren(fragment)
    rendered += entries.length
    logs.scrollTop = following ? logs.scrollHeight : scroll
    return action
  }
})()
`
