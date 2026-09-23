import { createTrayGlyphs } from './desktop-tray-glyphs.mjs'
import { projectAccentColor, sanitizeTrayProjectState, summarizeTrayWorkers, trayStatusLabel } from './desktop-tray-model.mjs'

const MAX_NOTIFICATIONS = 24
// Session polling and the agent-runtime broadcast both reach the tray, so a
// busy project rebuilt the whole menu several times a second. On Linux that
// re-exports the complete DBus menu and can close one the operator has open,
// so rebuilds are coalesced and skipped entirely when nothing rendered changed.
const REFRESH_COALESCE_MS = 150
const LINUX_TRAY_ICON_SIZE = 22
const TRAY_ICON_SIZE = 16

export function createDesktopTrayControl(deps) {
  let tray
  let refreshTimer
  let signature = ''
  const notifications = new Map()
  const projectStates = new Map()
  const icon = createTrayGlyphs(deps.nativeImage)
  const action = (projectPath, name) => { deps.restoreProject(projectPath); deps.sendProjectAction(projectPath, name) }

  function openNotification(record) {
    if (!record) return false
    // Marking it read before the window answers loses the notification whenever
    // no window owns that project any more: it stops counting as unread, so the
    // tray click handler never offers it again.
    if (!deps.restoreProject(record.projectPath)) return false
    record.read = true
    refresh()
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
    const accent = projectAccentColor(projectPath)
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

  function workerMenu(summary) {
    const items = [{ label: `${summary.busy}/${summary.total} Workers em trabalho${summary.errors ? ` · ${summary.errors} erro(s)` : ''}`, enabled: false }]
    items.push({ type: 'separator' }, summary.paused
      ? { label: 'Retomar Workers', icon: icon('resume'), click: () => { void deps.resumeWorkers() } }
      : { label: 'Pausar Workers', icon: icon('pause'), click: () => { void deps.pauseWorkers() } })
    if (summary.workers.length) items.push({ type: 'separator' }, ...summary.workers.map((worker) => ({ label: `${worker.label} · ${worker.status}`, enabled: false })))
    return { label: `Workers${summary.busy ? ` (${summary.busy})` : ''}`, icon: icon('workers'), submenu: items }
  }

  // A rebuild runs on a timer, so an exception here reaches the main process as
  // an unhandled one. It is reported and the signature reset, so the next state
  // change rebuilds rather than being skipped as already rendered.
  function render() {
    if (!tray || tray.isDestroyed()) return
    try {
      const projects = deps.listProjects()
      const recent = [...notifications.values()].reverse()
      const unread = recent.filter((record) => !record.read).length
      const workers = summarizeTrayWorkers(deps.workerState())
      const next = JSON.stringify([projects.map((projectPath) => [deps.projectLabel(projectPath), projectStates.get(projectPath) || null]), recent.map((record) => [record.id, record.read, record.title, record.projectPath]), workers])
      if (next === signature) return
      signature = next
      const template = []
      if (recent.length) template.push({ label: `Notificações${unread ? ` (${unread})` : ''}`, icon: icon('bell'), submenu: recent.slice(0, 12).map((record) => ({ label: `${record.read ? '' : '• '}${record.title} · ${deps.projectLabel(record.projectPath)}`, click: () => openNotification(record) })) }, { type: 'separator' })
      template.push(...projects.map(projectMenu))
      if (!projects.length) template.push({ label: 'Nenhum projeto aberto', enabled: false })
      template.push({ type: 'separator' }, workerMenu(workers), { label: 'Mostrar Wharnex', icon: icon('project'), click: () => deps.showFallback() }, { type: 'separator' }, { label: 'Sair', icon: icon('close'), click: () => { void deps.quit() } })
      tray.setToolTip(`Wharnex · ${deps.instanceName}${unread ? ` · ${unread} notificação${unread === 1 ? '' : 'ões'}` : ''}${workers.busy ? ` · ${workers.busy} Worker${workers.busy === 1 ? '' : 's'}` : ''}`)
      tray.setContextMenu(deps.Menu.buildFromTemplate(template))
    } catch (error) {
      signature = ''
      deps.warn?.('[tray] menu refresh failed', error)
    }
  }

  function refresh() {
    if (!tray || tray.isDestroyed() || refreshTimer) return
    refreshTimer = setTimeout(() => { refreshTimer = undefined; render() }, Math.max(0, deps.refreshDelayMs ?? REFRESH_COALESCE_MS))
    refreshTimer.unref?.()
  }

  function onTrayClick() {
    const unread = [...notifications.values()].reverse().find((record) => !record.read)
    if (unread && openNotification(unread)) return
    const first = deps.listProjects()[0]
    if (first && deps.restoreProject(first)) return
    deps.showFallback()
  }

  return {
    // The tray is ensured from the close-to-background path and from
    // `window-all-closed`. A throw here (no system tray host yet, a rejected
    // image) would leave a window that refuses to hide, so failure is reported
    // and retried on the next ensure instead of propagating.
    ensure() {
      if (tray && !tray.isDestroyed()) { render(); return tray }
      const size = deps.platform === 'linux' ? LINUX_TRAY_ICON_SIZE : TRAY_ICON_SIZE
      try {
        tray = new deps.Tray(deps.icon.resize({ width: size, height: size, quality: 'best' }))
      } catch (error) {
        tray = undefined
        deps.warn?.('[tray] tray creation failed', error)
        return undefined
      }
      tray.on('click', onTrayClick)
      signature = ''
      render()
      return tray
    },
    refresh,
    publishNotification,
    updateProjectState(projectPath, request) {
      projectStates.set(projectPath, sanitizeTrayProjectState(projectPath, request))
      refresh()
    },
    forgetProject(projectPath) {
      if (!projectStates.delete(projectPath)) return
      refresh()
    },
    destroy() {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = undefined
      signature = ''
      if (tray && !tray.isDestroyed()) {
        try { tray.destroy() } catch (error) { deps.warn?.('[tray] tray destruction failed', error) }
      }
      tray = undefined
    },
  }
}
