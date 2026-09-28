// Only a bounded structural field name from our strict validator may cross
// back into the remote conversation. The rejected bundle itself is untrusted.
export function orchestratorBundleRepairPrompt(error, filename) {
  const message = String(error?.message || '')
  if (!message.startsWith('orchestrator Worker worker-bundle HTTP 409: decode plan.json:')) return ''
  const field = message.match(/unknown field "([A-Za-z][A-Za-z0-9_]{0,63})"/)
  if (!field) return ''
  const expected = String(filename || '')
  if (!/^whx_bundle_res_[A-Za-z0-9_-]{1,160}\.zip$/.test(expected)) return ''
  return `O validador do Wharnex rejeitou o ZIP anterior: plan.json contém o campo não permitido "${field[1]}". Corrija plan.json conforme o protocolo da requisição original, remova esse campo e gere um NOVO ZIP com o nome exato ${expected}. Não responda apenas em texto.`
}
