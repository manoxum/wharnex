// Empty-claim backoff for the durable browser-agent scheduler loops.
//
// Every Worker and Supervisor loop claims on a short idle cadence. With the
// pools at full size that was a dozen claim queries a second against an empty
// queue, all day. Consecutive empty claims now widen the wait exponentially up
// to a small ceiling; any claimed task or explicit wake() resets it. Residency
// and pin release are measured in elapsed time, not in claim counts, so the
// ceiling only delays those releases by at most one backoff step.
export const DEFAULT_CHAT_AGENT_IDLE_CEILING_MS = 3_000

export function chatAgentIdleDelay(emptyClaims, baseMs, ceilingMs = DEFAULT_CHAT_AGENT_IDLE_CEILING_MS) {
  const base = Math.max(0, Number(baseMs) || 0)
  const ceiling = Math.max(base, Number(ceilingMs) || 0)
  const streak = Math.max(1, Math.floor(Number(emptyClaims) || 1))
  return Math.min(ceiling, base * 2 ** Math.min(streak - 1, 16))
}
