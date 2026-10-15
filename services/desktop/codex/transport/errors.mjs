export function codexRPCError(method, error) {
  const writerBusy = /^thread [a-f0-9-]{36} already has an active writer$/i.test(String(error.message || ''))
  return Object.assign(new Error(writerBusy
    ? 'Esta conversa está aberta noutro cliente Codex. Feche ou liberte a conversa nesse cliente e volte a continuar.'
    : `O Codex recusou ${method}. Consulte o estado da conta e tente novamente.`), {
    code: Number(error.code) || 0, ...(writerBusy ? { reason: 'threadWriterBusy' } : {}),
  })
}
