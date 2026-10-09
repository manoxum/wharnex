export const CHATGPT_REASONING_EFFORTS = Object.freeze(['instant', 'medium', 'high'])

export function normalizeChatGPTReasoningEffort(value, fallback = 'high') {
  const normalized = String(value || '').trim().toLowerCase()
  if (CHATGPT_REASONING_EFFORTS.includes(normalized)) return normalized
  if (normalized) throw new Error(`Unsupported ChatGPT reasoning effort ${normalized}`)
  if (CHATGPT_REASONING_EFFORTS.includes(fallback)) return fallback
  throw new Error('Invalid fallback ChatGPT reasoning effort')
}

// Provider-agnostic by design: `observe` reads the current level and `cycle`
// moves it one step, however the caller's UI represents that (the Desktop
// interaction module currently drives ChatGPT's own ARIA slider
// control). Every step is re-verified through `observe` before a prompt is
// allowed to submit, and the whole exchange is bounded to one pass over the
// closed value set - if ChatGPT changes that control again, this stays
// correct and only the caller's `cycle` needs to change.
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
      console.warn(`[chatgpt-effort] unavailable state=${String(result?.state || 'unknown')} labels=${JSON.stringify((result?.labels || []).slice(0, 8).map((label) => String(label).slice(0, 120)))}`)
      throw Object.assign(new Error(`ChatGPT reasoning effort is unavailable (${String(result?.state || 'unknown')})`), { retryTransport: false })
    }
    seen.push(result.effort)
    if (result.effort === wanted) return { effort: wanted, changed: attempt > 0, cycles: attempt }
    if (attempt === CHATGPT_REASONING_EFFORTS.length) break
    await cycle()
    await wait(settleMs)
  }
  throw Object.assign(new Error(`ChatGPT reasoning effort did not reach ${wanted} after bounded cycling (${seen.join(' -> ')})`), { retryTransport: false })
}
