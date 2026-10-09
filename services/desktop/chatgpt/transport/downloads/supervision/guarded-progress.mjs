// Exact-only capture must not recover or continue a historical/restored turn.
// A generating control is still safe passive evidence for its durable lease.
export async function observeGuardedResponseProgress({ expected, wc, now, attention, completionScript }) {
  if (!attention && !expected.rehydrating) return false
  try {
    const state = await wc.executeJavaScript(completionScript(expected.assistantBaseline), true)
    if (state?.thinking === true || (!expected.rehydrating && state?.complete === true)) expected.progressAt = now
  } catch { /* diagnostic absence is never evidence of stopped generation */ }
  return Boolean(attention)
}
