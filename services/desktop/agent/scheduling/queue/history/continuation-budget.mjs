function count(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

export async function restoredContinuationCount(scheduler, tasks, key, requestId, expected) {
  let maximum = Math.max(count(expected?.continuationCount), count(expected?.recoveryCount),
    expected?.automaticContinuationSent === true ? 1 : 0)
  const ownedTaskIds = new Set()
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (task.request_id === requestId && task.chat_id === key) {
      maximum = Math.max(maximum, count(task.payload?.recovery_count))
      if (task.task_id) ownedTaskIds.add(task.task_id)
    }
  }
  try {
    const { events } = await scheduler.requestEvents(requestId)
    if (Array.isArray(events) && events.some((event) => event.request_id === requestId
      && (event.chat_id === key || (!event.chat_id && ownedTaskIds.has(event.task_id)))
      && event.type === 'chatgpt.recovery_keep_continue')) {
      maximum = Math.max(maximum, 1)
    }
  } catch {
    // Observation-only restoration cannot write even when history is unavailable.
    console.warn('[chat-agent] continuation history unavailable; restored observation remains passive')
  }
  return maximum
}
