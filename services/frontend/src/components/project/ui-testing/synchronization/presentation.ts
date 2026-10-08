import type { UITestingDocument } from '../../../../types'

export function syncPresentation(doc: UITestingDocument) {
  if (doc.sync_status !== 'syncing') {
    return {
      label: doc.sync_status === 'failed' ? 'última sincronização falhou' : doc.sync_status === 'ready' ? 'sincronizado com o projeto' : 'ainda não sincronizado',
      detail: doc.sync_status === 'failed' ? 'A descoberta falhou. Use Sincronizar para tentar novamente.' : 'Sincronize para o GPT descobrir os testes de UI, ou use Novo para descrever um teste.',
    }
  }
  const activity = doc.sync_activity
  if (activity?.state === 'queued') {
    return { label: 'sincronização na fila', detail: 'A sincronização está na fila para um Worker.' }
  }
  if (activity?.state === 'waiting') {
    const retryAt = Date.parse(activity.not_before || '')
    const deadline = Number.isFinite(retryAt)
      ? ` Nova tentativa a partir de ${new Date(retryAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`
      : ''
    return { label: 'sincronização em espera', detail: `A sincronização está em espera.${activity.reason ? ` ${activity.reason}` : ''}${deadline}` }
  }
  if (activity?.state === 'running') {
    const worker = activity.worker ? `Worker ${activity.worker}` : 'Worker'
    return { label: `${worker} a descobrir testes`, detail: `O ${worker} está a descobrir os testes de UI do projeto.` }
  }
  return { label: 'a confirmar sincronização', detail: 'A confirmar o estado da sincronização…' }
}
