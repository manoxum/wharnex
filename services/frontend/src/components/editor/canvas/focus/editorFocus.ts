/** Deferred model/reveal work must not dismiss a floating surface the user opened. */
export function focusEditorWhenAvailable(editor: { focus: () => void }, host: HTMLElement | null) {
  const active = document.activeElement
  const floating = active instanceof Element ? active.closest('[role="dialog"], [role="menu"]') : null
  if (floating && !host?.contains(active) && !floating.contains(host)) return
  editor.focus()
}
