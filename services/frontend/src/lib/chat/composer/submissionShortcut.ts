type Key = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; preventDefault(): void; stopPropagation(): void }

export const activeComposerLabel = (engine: string) => engine === 'codex' ? 'Codex ativo · Ctrl+Enter envia orientação' : 'Request ativa · Ctrl+Enter comenta'
export const activeComposerHint = (engine: string) => `Enter adiciona à fila · Ctrl+Enter envia ${engine === 'codex' ? 'orientação' : 'comentário'} · Shift+Enter cria linha`

export function handleComposerSubmitShortcut(event: Key) {
  if (event.key !== 'Enter' || event.shiftKey) return false
  event.preventDefault(); event.stopPropagation()
  return true
}
