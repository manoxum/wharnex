const MAX_SUGGESTIONS = 8

export function spellcheckContextMenuTemplate(params = {}, actions = {}) {
  if (!params.isEditable) return []

  const editFlags = params.editFlags || {}
  const misspelledWord = String(params.misspelledWord || '').trim()
  const suggestions = Array.isArray(params.dictionarySuggestions)
    ? [...new Set(params.dictionarySuggestions.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, MAX_SUGGESTIONS)
    : []
  const template = []

  if (misspelledWord) {
    if (suggestions.length) {
      for (const suggestion of suggestions) {
        template.push({ label: suggestion, click: () => actions.replaceMisspelling?.(suggestion) })
      }
    } else {
      template.push({ label: 'Sem sugestões', enabled: false })
    }
    template.push({ type: 'separator' })
    template.push({ label: 'Adicionar ao dicionário', click: () => actions.addToDictionary?.(misspelledWord) })
    template.push({ type: 'separator' })
  }

  template.push(
    { label: 'Desfazer', role: 'undo', enabled: Boolean(editFlags.canUndo) },
    { label: 'Refazer', role: 'redo', enabled: Boolean(editFlags.canRedo) },
    { type: 'separator' },
    { label: 'Cortar', role: 'cut', enabled: Boolean(editFlags.canCut) },
    { label: 'Copiar', role: 'copy', enabled: Boolean(editFlags.canCopy) },
    { label: 'Colar', role: 'paste', enabled: Boolean(editFlags.canPaste) },
    { type: 'separator' },
    { label: 'Selecionar tudo', role: 'selectAll', enabled: Boolean(editFlags.canSelectAll) },
  )
  return template
}
