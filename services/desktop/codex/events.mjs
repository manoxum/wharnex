export function createCodexEvents({ records, save, publish, deliver, logger = console }) {
  return async function notification(method, params) {
    const record = records().find((item) => item.threadId === params.threadId)
    if (!record) return
    if (params.turnId && record.turnId && params.turnId !== record.turnId) return
    if (method === 'turn/completed' && (!['running', 'submitting'].includes(record.status) || (record.turnId && params.turn?.id !== record.turnId))) return
    if (method === 'thread/tokenUsage/updated') record.tokenUsage = params.tokenUsage
    if (method === 'item/agentMessage/delta') {
      const id = String(params.itemId || '').slice(0, 200)
      let message = record.messages.find((item) => item.id === id)
      if (!message) { message = { id, text: '' }; record.messages.push(message) }
      message.text = (message.text + String(params.delta || '')).slice(0, 65536)
      record.messages = record.messages.slice(-40)
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const id = String(params.item.id || '').slice(0, 200)
      const text = String(params.item.text || '').slice(0, 65536)
      record.messages = [...record.messages.filter((item) => item.id !== id), { id, text }].slice(-40)
    }
    if (method === 'turn/started' && !['running', 'submitting'].includes(record.status)) return
    if (method === 'turn/started') { record.turnId = params.turn?.id; record.status = 'running' }
    if (method === 'turn/completed') {
      const completed = params.turn?.status === 'completed'
      record.status = completed && record.outputPath ? 'ready' : 'attention'
      record.error = record.status === 'attention' ? 'O Codex terminou sem um bundle válido para entrega. Reveja a conversa antes de repetir.' : ''
      await save(record)
      logger.info('[codex] turn settled', { chat_id: record.chatId, session_id: record.sessionId, request_id: record.requestId, status: record.status })
      if (record.status === 'ready') await deliver(record)
    }
    publish(record)
  }
}

export function publicCodexThread(record) {
  return {
    projectPath: record.projectPath, chatId: record.chatId, threadId: record.threadId, title: record.title,
    requestId: record.requestId, model: record.model, status: record.status,
    error: record.error || '', tokenUsage: record.tokenUsage || null,
    messages: record.messages || [],
  }
}
