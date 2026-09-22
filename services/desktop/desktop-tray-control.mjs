import { projectAccentHSL, sanitizeTrayProjectState, summarizeTrayWorkers, trayStatusLabel } from './desktop-tray-model.mjs'

const MAX_NOTIFICATIONS = 24
const GLYPHS = {
  project: '<circle cx="8" cy="8" r="5"/>', bell: '<path d="M5 11h6M6 11V7a2 2 0 0 1 4 0v4M7 13h2"/>',
  plan: '<path d="M4 3h8v10H4zM6 6h4M6 9h4"/>', play: '<path d="M6 4l6 4-6 4z"/>',
  pause: '<path d="M5 4h2v8H5zM9 4h2v8H9z"/>', resume: '<path d="M5 4l6 4-6 4z"/>',
  workers: '<circle cx="5" cy="6" r="2"/><circle cx="11" cy="6" r="2"/><path d="M2 13c0-2 1-3 3-3s3 1 3 3M8 13c0-2 1-3 3-3s3 1 3 3"/>',
  network: '<circle cx="8" cy="8" r="2"/><path d="M3 8h3M10 8h3M8 3v3M8 10v3"/>', close: '<path d="M4 4l8 8M12 4l-8 8"/>',
}

function svgIcon(nativeImage, name, color = '#9ca3af') {
  const body = GLYPHS[name] || GLYPHS.project
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><g fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

export function createDesktopTrayControl(deps) {
  let tray
  const notifications = new Map()
  const projectStates = new Map()
  const icon = (name, color) => svgIcon(deps.nativeImage, name, color)
  const action = (projectPath, name) => { deps.restoreProject(projectPath); deps.sendProjectAction(projectPath, name) }

  function openNotification(record) {
    if (!record) return false
    record.read = true
    refresh()
    if (!deps.restoreProject(record.projectPath)) return false
    deps.sendNotificationOpen(record.projectPath, { ...record })
    return true
  }

  function publishNotification(record) {
    if (notifications.has(record.id)) return { ok: true, duplicate: true, id: record.id }
    notifications.set(record.id, { ...record, read: false })
    while (notifications.size > MAX_NOTIFICATIONS) notifications.delete(notifications.keys().next().value)
    refresh()
    if (deps.Notification.isSupported()) {
      try {
        const native = new deps.Notification({ title: record.title, body: record.body, silent: false })
        native.on('click', () => openNotification(notifications.get(record.id)))
        native.show()
      } catch (error) { deps.warn?.('[notifications] native notification failed', error) }
    }
    return { ok: true, duplicate: false, id: record.id }
  }

  function projectMenu(projectPath) {
    const state = projectStates.get(projectPath)
    const accent = projectAccentHSL(projectPath)
    const items = [
      { label: trayStatusLabel(state), enabled: false },
      { type: 'separator' },
      { label: 'Abrir projeto', icon: icon('project', accent), click: () => deps.restoreProject(projectPath) },
      { label: `Notificações${state?.attentionTotal ? ` (${state.attentionTotal})` : ''}`, icon: icon('bell'), click: () => action(projectPath, 'open-notifications') },
      { label: 'Plano', icon: icon('plan'), click: () => action(projectPath, 'open-plan') },
      { label: 'Execução', icon: icon('play'), click: () => action(projectPath, 'open-execution') },
    ]
    if (state?.canApproveExecution) items.push({ label: 'Aprovar e executar', icon: icon('play'), click: () => action(projectPath, 'approve-execution') })
    if (state?.canControlExecution) {
      items.push(state.planControl === 'active'
        ? { label: 'Pausar execução', icon: icon('pause'), click: () => action(projectPath, 'pause-execution') }
        : { label: 'Retomar execução', icon: icon('resume'), click: () => action(projectPath, 'resume-execution') })
      if (state.planControl !== 'suspended') items.push({ label: 'Suspender execução', icon: icon('close'), click: () => action(projectPath, 'suspend-execution') })
    }
    if (state?.canContinueRequest) items.push({ label: 'Continuar pedido', icon: icon('resume'), click: () => action(projectPath, 'continue-request') })
    items.push({ type: 'separator' })
    items.push({ label: 'Gerir Workers', icon: icon('workers'), click: () => action(projectPath, 'open-workers') })
    items.push({ label: `Túneis${state?.tunnelCount ? ` (${state.tunnelCount})` : ''}`, icon: icon('network'), click: () => action(projectPath, 'open-tunnels') })
    items.push({ type: 'separator' }, { label: 'Fechar projeto', icon: icon('close'), click: () => deps.closeProject(projectPath) })
    return { label: deps.projectLabel(projectPath), icon: icon('project', accent), submenu: items }
  }

  function workerMenu() {
    const summary = summarizeTrayWorkers(deps.workerState())
    const items = [{ label: `${summary.busy}/${summary.total} Workers em trabalho${summary.errors ? ` · ${summary.errors} erro(s)` : ''}`, enabled: false }]
    items.push({ type: 'separator' }, summary.paused
      ? { label: 'Retomar Workers', icon: icon('resume'), click: () => { void deps.resumeWorkers() } }
      : { label: 'Pausar Workers', icon: icon('pause'), click: () => { void deps.pauseWorkers() } })
    if (summary.workers.length) items.push({ type: 'separator' }, ...summary.workers.map((worker) => ({ label: `${worker.label} · ${worker.status}`, enabled: false })))
    return { label: `Workers${summary.busy ? ` (${summary.busy})` : ''}`, icon: icon('workers'), submenu: items }
  }

  function refresh() {
    if (!tray || tray.isDestroyed()) return
    const projects = deps.listProjects()
    const recent = [...notifications.values()].reverse()
    const unread = recent.filter((record) => !record.read).length
    const template = []
    if (recent.length) template.push({ label: `Notificações${unread ? ` (${unread})` : ''}`, icon: icon('bell'), submenu: recent.slice(0, 12).map((record) => ({ label: `${record.read ? '' : '• '}${record.title} · ${deps.projectLabel(record.projectPath)}`, click: () => openNotification(record) })) }, { type: 'separator' })
    template.push(...projects.map(projectMenu))
    if (!projects.length) template.push({ label: 'Nenhum projeto aberto', enabled: false })
    template.push({ type: 'separator' }, workerMenu(), { label: 'Mostrar Wharnex', icon: icon('project'), click: () => deps.showFallback() }, { type: 'separator' }, { label: 'Sair', icon: icon('close'), click: () => { void deps.quit() } })
    const workers = summarizeTrayWorkers(deps.workerState())
    tray.setToolTip(`Wharnex · ${deps.instanceName}${unread ? ` · ${unread} notificação${unread === 1 ? '' : 'ões'}` : ''}${workers.busy ? ` · ${workers.busy} Worker${workers.busy === 1 ? '' : 's'}` : ''}`)
    tray.setContextMenu(deps.Menu.buildFromTemplate(template))
  }

  return {
    ensure() { if (tray && !tray.isDestroyed()) { refresh(); return tray }; tray = new deps.Tray(deps.icon.resize({ width: 18, height: 18 })); tray.on('click', () => { const unread = [...notifications.values()].reverse().find((record) => !record.read); if (unread && openNotification(unread)) return; const first = deps.listProjects()[0]; if (first && deps.restoreProject(first)) return; deps.showFallback() }); refresh(); return tray },
    refresh,
    publishNotification,
    updateProjectState(projectPath, request) { projectStates.set(projectPath, sanitizeTrayProjectState(projectPath, request)); refresh() },
    forgetProject(projectPath) { projectStates.delete(projectPath); refresh() },
  }
}
