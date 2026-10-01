import path from 'node:path'
import { rm } from 'node:fs/promises'

export async function startDesktopRuntime({
  app, applyPendingBrowserSessionImport, logger, configureChatGPTSession,
  chatGPTSessionOptions, loadChatAgentPolicies, setChatAgentPolicies,
  registerIPC, ensureDesktopTray, beginDownloadPoller, restoreDesktopWindows,
  restoreWindowsOptions, refreshDesktopTray, desktopWindows, worker,
  translator, supervisor, refreshChatAgentRuntimeState,
  publishChatAgentRuntimeState, scheduleWorkerStart = setTimeout,
}) {
  await rm(path.join(app.getPath('temp'), 'wharness-chat-protocol'), { recursive: true, force: true }).catch(() => undefined)
  try { await applyPendingBrowserSessionImport() }
  catch (error) { logger.error('[chatgpt-session] pending import failed', error) }
  await configureChatGPTSession(chatGPTSessionOptions)
  setChatAgentPolicies(loadChatAgentPolicies())
  registerIPC()
  ensureDesktopTray()
  beginDownloadPoller()

  restoreDesktopWindows(restoreWindowsOptions)
  refreshDesktopTray()

  const workerHost = [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
  const workerScheduler = worker.create({ ...worker.options, workerHost })
  worker.assign(workerScheduler)
  // Let the local frontend paint before hidden WebContents start. The queue is durable.
  scheduleWorkerStart(async () => {
    if (worker.isQuitting()) return
    await worker.prime(workerHost)
    if (worker.isQuitting()) return
    workerScheduler.start()
  }, worker.startupDelayMs)

  // Utility tasks have their own ephemeral consumer and never borrow a Worker.
  const translatorScheduler = translator.create(translator.options)
  translator.assign(translatorScheduler)
  translatorScheduler.start()

  // One durable-queue loop per fixed Supervisor slot.
  const supervisorScheduler = supervisor.create(supervisor.options)
  supervisor.assign(supervisorScheduler)
  supervisorScheduler.start()
  void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
}
