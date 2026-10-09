// Partial context increments have no engine-imposed ceiling: the GPT decides
// when it has read enough. These labels therefore name the round and never a
// "round of N" fraction that would suggest a limit.

export function contextIncrementNotice(round: number): string {
  return `Contexto incrementado (ronda ${round}). Os ficheiros pedidos pelo GPT seguem na continuação automática.`
}

export function contextIncrementMeta(round: number, selectedFiles: number): string {
  return `Contexto Parcial · ronda ${round} · ${selectedFiles} ${selectedFiles === 1 ? 'ficheiro' : 'ficheiros'}`
}
