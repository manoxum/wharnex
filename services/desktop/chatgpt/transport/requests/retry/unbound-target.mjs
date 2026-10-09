export async function resolvePersistedRetryTarget(context, request, key, sessionId, requestId) {
  const { canonicalChatGPTConversationURL, fetch, BACKEND_URL } = context
  const supplied = String(request?.url || '').trim()
  const linked = canonicalChatGPTConversationURL(supplied)
  if (linked) return linked
  const failure = () => new Error('Não foi possível provar que este pedido ainda aguarda o primeiro envio. Restaure a vinculação ou consulte a supervisão antes de reenviar.')
  if (supplied && supplied !== 'https://chatgpt.com/') throw failure()
  const routes = [
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    `/api/workspace-chats/${encodeURIComponent(key)}/binding-recovery`,
    `/api/chat-agent/tasks?request_id=${encodeURIComponent(requestId)}&limit=200`,
  ]
  const results = await Promise.allSettled(routes.map(async (route) => {
    const response = await fetch(new URL(route, BACKEND_URL), { redirect: 'error' })
    if (!response.ok) throw failure()
    return response.json()
  }))
  if (results.some((result) => result.status !== 'fulfilled')) throw failure()
  const [session, binding, ledger] = results.map((result) => result.value)
  if (!requestId || session.id !== sessionId || session.chat_id !== key || session.state !== 'awaiting_plan' ||
      session.last_request_id !== requestId || !session.pending_manual_request_ids?.includes(requestId)) throw failure()
  if (binding.chat_id !== key || binding.bound !== false || binding.chatgpt_url ||
      !Array.isArray(binding.candidates) || binding.candidates.length) throw failure()
  if (!Array.isArray(ledger.tasks) || ledger.tasks.length >= 200) throw failure()
  // A failed write may have crossed dispatch before losing its affinity.
  // Without a bound conversation there is no structural proof of non-delivery.
  if (ledger.tasks.some((task) => ['AWAIT_RESPONSE', 'BOT_WRITE', 'RECOVERY_WRITE'].includes(task.type))) throw failure()
  return 'https://chatgpt.com/'
}
