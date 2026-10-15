export function installCompletionObserver() {
  if (!new URLSearchParams(location.search).has('notifications')) return
  Object.assign(window.wharnessDesktop!, { notifications: {
    publish: async (notice: DesktopCompletionNotification) => {
      window.dispatchEvent(new CustomEvent('wharnex:fixture-completion', { detail: notice }))
      return { ok: true, duplicate: false, id: notice.id }
    },
  } })
}
