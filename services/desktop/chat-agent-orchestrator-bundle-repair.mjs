// Only bounded structural tokens from our strict validator may cross back into
// the remote conversation. The rejected bundle itself is untrusted.
const PREFIX = 'orchestrator Worker worker-bundle HTTP 409: '
const KNOWLEDGE_ID = '[a-z0-9][a-z0-9._-]{0,95}'

function repairRule(detail) {
  if (detail.startsWith('decode plan.json:')) {
    const field = detail.match(/unknown field "([A-Za-z][A-Za-z0-9_]{0,63})"/)
    if (field) return `plan.json contém o campo não permitido "${field[1]}". Corrija plan.json conforme o protocolo da requisição original e remova esse campo`
    return ''
  }
  let match = detail.match(new RegExp(`^knowledge "(${KNOWLEDGE_ID})" must use file (knowledge/${KNOWLEDGE_ID}\\.md)$`))
  if (match) return `knowledge/index.json declara a entrada "${match[1]}" com um caminho errado. O campo file dessa entrada tem de ser exatamente ${match[2]}, e o conteúdo tem de estar nesse ficheiro dentro do ZIP`
  match = detail.match(new RegExp(`^knowledge "(${KNOWLEDGE_ID})" references missing (knowledge/${KNOWLEDGE_ID}\\.md)$`))
  if (match) return `knowledge/index.json declara a entrada "${match[1]}", mas o ZIP não contém ${match[2]}. Inclua esse ficheiro com o conteúdo da entrada, ou remova a entrada do índice`
  match = detail.match(new RegExp(`^knowledge "(${KNOWLEDGE_ID})" is empty$`))
  if (match) return `a entrada de knowledge "${match[1]}" está vazia. Escreva o conteúdo dessa entrada ou remova-a do índice`
  return ''
}

export function orchestratorBundleRepairPrompt(error, filename) {
  const message = String(error?.message || '')
  if (!message.startsWith(PREFIX)) return ''
  const rule = repairRule(message.slice(PREFIX.length).trim())
  if (!rule) return ''
  const expected = String(filename || '')
  if (!/^whx_bundle_res_[A-Za-z0-9_-]{1,160}\.zip$/.test(expected)) return ''
  return `O validador do Wharnex rejeitou o ZIP anterior: ${rule}. Gere um NOVO ZIP com o nome exato ${expected}. Não responda apenas em texto.`
}

// A 409 from the bundle endpoint that no correction prompt can fix (a stale
// command plan, a rule outside the repair list) rejects the same ZIP every
// time, so retrying the attempt only downloads and re-submits it again. Such a
// rejection ends the run; a mismatch with the active request does not, because
// the Agent may simply have moved to its next request.
export function orchestratorBundleRejectionTerminal(error) {
  const message = String(error?.message || '')
  if (!message.startsWith(PREFIX)) return false
  return !message.includes('does not match the active Agent request')
}
