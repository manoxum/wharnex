export const CHATGPT_REASONING_EFFORTS = Object.freeze(['instant', 'medium', 'high'])

export function normalizeChatGPTReasoningEffort(value, fallback = 'high') {
  const normalized = String(value || '').trim().toLowerCase()
  if (CHATGPT_REASONING_EFFORTS.includes(normalized)) return normalized
  if (normalized) throw new Error(`Unsupported ChatGPT reasoning effort ${normalized}`)
  if (CHATGPT_REASONING_EFFORTS.includes(fallback)) return fallback
  throw new Error('Invalid fallback ChatGPT reasoning effort')
}

// Ctrl+Shift+M is advertised by ChatGPT's own effort control. Cycling the
// closed three-value set is less fragile than guessing a coordinate inside its
// custom slider, and every cycle is verified from the composer pill before a
// prompt is allowed to submit.
export async function ensureChatGPTReasoningEffort({
  target,
  observe,
  cycle,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  settleMs = 180,
}) {
  const wanted = normalizeChatGPTReasoningEffort(target)
  const seen = []
  for (let attempt = 0; attempt <= CHATGPT_REASONING_EFFORTS.length; attempt += 1) {
    const result = await observe()
    if (!result?.ok || !CHATGPT_REASONING_EFFORTS.includes(result.effort)) {
      throw new Error(`ChatGPT reasoning effort is unavailable (${String(result?.state || 'unknown')})`)
    }
    seen.push(result.effort)
    if (result.effort === wanted) return { effort: wanted, changed: attempt > 0, cycles: attempt }
    if (attempt === CHATGPT_REASONING_EFFORTS.length) break
    await cycle()
    await wait(settleMs)
  }
  throw new Error(`ChatGPT reasoning effort did not reach ${wanted} after bounded cycling (${seen.join(' -> ')})`)
}
