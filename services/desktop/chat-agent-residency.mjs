export const DEFAULT_CHAT_AGENT_RESIDENCY_MS = 60_000
export const MIN_CHAT_AGENT_RESIDENCY_MS = 30_000
export const MAX_CHAT_AGENT_RESIDENCY_MS = 120_000
export const CHAT_AGENT_NAVIGATION_GAP_MS = 30_000
export const CHAT_AGENT_AWAIT_PROBE_MS = 30_000

// How long a slot may keep a resident lane that is producing no work before the
// lane is released and the slot rejoins the free pool.
//
// Residency is an affinity cache, not ownership. Without an expiry it became
// ownership: a resident slot claims `resident_only`, so it can only ever be
// rebound by claiming a task from another lane — which `resident_only` forbids.
// Once every slot had served one conversation, each stayed pinned to it for the
// rest of the process, including long after that chat was resolved. Only the
// head of the rotation could escape, and only while no slot was free, so the
// pool degraded to a single effective worker while other lanes held due work.
export const DEFAULT_CHAT_AGENT_IDLE_RELEASE_MS = 20_000
export const MIN_CHAT_AGENT_IDLE_RELEASE_MS = 5_000
export const MAX_CHAT_AGENT_IDLE_RELEASE_MS = 120_000

export function chatAgentLane(task = {}) {
  const conversation = String(task.conversation_id || task.conversationId || '').trim()
  if (conversation) return `c:${conversation}`
  const chat = String(task.chat_id || task.chatId || '').trim()
  return chat ? `h:${chat}` : ''
}

export function chatAgentConversationFromLane(lane = '') {
  const value = String(lane || '')
  return value.startsWith('c:') ? value.slice(2) : ''
}

function normalizeResidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_CHAT_AGENT_RESIDENCY_MS
  return Math.max(MIN_CHAT_AGENT_RESIDENCY_MS, Math.min(MAX_CHAT_AGENT_RESIDENCY_MS, Math.floor(numeric)))
}

function normalizeIdleRelease(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_CHAT_AGENT_IDLE_RELEASE_MS
  return Math.max(MIN_CHAT_AGENT_IDLE_RELEASE_MS, Math.min(MAX_CHAT_AGENT_IDLE_RELEASE_MS, Math.floor(numeric)))
}

export class ChatAgentResidency {
  constructor({
    minResidenceMs = DEFAULT_CHAT_AGENT_RESIDENCY_MS,
    idleReleaseMs = DEFAULT_CHAT_AGENT_IDLE_RELEASE_MS,
    now = () => Date.now(),
  } = {}) {
    this.minResidenceMs = normalizeResidence(minResidenceMs)
    this.idleReleaseMs = normalizeIdleRelease(idleReleaseMs)
    this.now = now
    this.slots = new Map()
    this.rotation = []
  }

  register(slotId) {
    const id = String(slotId || '').trim()
    if (!id) throw new Error('slot id is required')
    if (!this.slots.has(id)) {
      this.slots.set(id, {
        slotId: id,
        residentLane: '',
        pendingLane: '',
        residentSince: 0,
        minResidentUntil: 0,
        assignmentEpoch: 0,
        nonPreemptive: 0,
        navigationInProgress: false,
        blocked: false,
        idleSince: 0,
      })
      this.rotation.push(id)
    }
    return this.slots.get(id)
  }

  retire(slotId) {
    const id = String(slotId || '').trim()
    this.slots.delete(id)
    this.rotation = this.rotation.filter((candidate) => candidate !== id)
  }

  state(slotId) {
    return this.register(slotId)
  }

  setNonPreemptive(slotId, active) {
    const state = this.register(slotId)
    state.nonPreemptive = Math.max(0, state.nonPreemptive + (active ? 1 : -1))
    return state.nonPreemptive
  }

  claimOptions(slotId, { blocked = false, pinResident = false } = {}) {
    const state = this.register(slotId)
    state.blocked = Boolean(blocked) || state.nonPreemptive > 0 || state.navigationInProgress
    if (state.blocked) return { skip: true }
    // Only a peer that can actually serve its lane may reserve it. Excluding a
    // blocked peer's lane unconditionally made that peer a lane monopolist: an
    // interacting, navigating or loading slot kept every other slot out of a
    // conversation it could not work itself, so a due AWAIT_RESPONSE on that
    // conversation was claimable by nobody at all. The backend still owns
    // conflict safety through the per-conversation write lock and the lease, so
    // handing the lane to a free slot cannot overlap real work.
    const excludedLanes = [...this.slots.values()]
      .filter((candidate) => candidate.slotId !== state.slotId && candidate.residentLane && !candidate.blocked)
      .map((candidate) => candidate.residentLane)
    if (!state.residentLane) {
      return { preferred_lane: '', excluded_lanes: excludedLanes, fallback_mode: 'unresident_only' }
    }
    // A resident AWAIT_RESPONSE is a live supervision, not an ordinary cache
    // hit. Never rotate that slot to an unresident lane merely because its
    // current probe is sleeping behind not_before. With N+1 generating chats
    // and N Workers, allowing the rotation head to cross lanes turns every
    // observation wave into cache thrash: each slot navigates away from one
    // live conversation to pick up the lane the previous slot just abandoned.
    // The excess supervision can safely wait until one of the resident turns
    // completes; navigating every live renderer is both more expensive and can
    // interrupt the very response AWAIT_RESPONSE exists to protect.
    if (pinResident) {
      return { preferred_lane: state.residentLane, excluded_lanes: excludedLanes, fallback_mode: 'resident_only' }
    }
    const anotherFree = [...this.slots.values()].some((candidate) => candidate.slotId !== state.slotId && !candidate.residentLane)
    const dwellComplete = this.now() >= state.minResidentUntil
    const rotationHead = this.rotation[0] === state.slotId
    return {
      preferred_lane: state.residentLane,
      excluded_lanes: excludedLanes,
      fallback_mode: !anotherFree && dwellComplete && rotationHead ? 'any' : 'resident_only',
    }
  }

  beginAssignment(slotId, lane) {
    const state = this.register(slotId)
    const target = String(lane || '').trim()
    const rebind = Boolean(target && target !== state.residentLane)
    if (!rebind) return { epoch: state.assignmentEpoch, rebind: false, lane: state.residentLane }
    if (state.nonPreemptive > 0 || state.navigationInProgress) throw new Error('worker slot is not preemptible')
    state.assignmentEpoch += 1
    state.pendingLane = target
    state.navigationInProgress = true
    return { epoch: state.assignmentEpoch, rebind: true, lane: target }
  }

  settleAssignment(slotId, epoch, lane, settledAt = this.now()) {
    const state = this.register(slotId)
    if (Number(epoch) !== state.assignmentEpoch) return false
    const target = String(lane || state.pendingLane || '').trim()
    if (!target) return false
    const changed = target !== state.residentLane
    state.pendingLane = ''
    state.navigationInProgress = false
    this.noteAssignment(state.slotId)
    if (!changed) return true
    state.residentLane = target
    state.residentSince = settledAt
    state.minResidentUntil = settledAt + this.minResidenceMs
    return true
  }

  /**
   * Sends the slot to the back of the rotation because it just took a task.
   *
   * The rotation decides which slot may escalate past its own resident lane, so
   * it has to advance on every assignment — not only when the lane changed. A
   * slot that keeps serving its own resident lane never rebinds, so it used to
   * stay permanently at the head: it remained the only one allowed to cross
   * lanes, concentrating cross-lane work on one Worker while unresident lanes
   * waited behind a slot that never yielded its turn.
   */
  noteAssignment(slotId) {
    const state = this.register(slotId)
    state.idleSince = 0
    this.rotation = this.rotation.filter((candidate) => candidate !== state.slotId)
    this.rotation.push(state.slotId)
    return this.rotation.indexOf(state.slotId)
  }

  /**
   * Records a claim that found no work and releases a lane that has gone quiet.
   *
   * This is what keeps affinity a cache instead of ownership. A resident slot
   * only ever claims its own lane, so the lane it is holding is precisely the
   * lane it has just proven to be empty. Releasing it returns the slot to the
   * free pool, where it claims `unresident_only` and can serve any conversation
   * that actually has due work — which is the whole point of a pool.
   *
   * The dwell is honoured first: a conversation that was just written to is
   * expected to be quiet while the model starts, and rebinding away from it
   * would cost the navigation that the dwell exists to avoid.
   */
  noteIdleClaim(slotId, at = this.now()) {
    const state = this.register(slotId)
    if (!state.residentLane || state.nonPreemptive > 0 || state.navigationInProgress) return false
    if (!state.idleSince) state.idleSince = at
    if (at < state.minResidentUntil || at - state.idleSince < this.idleReleaseMs) return false
    state.residentLane = ''
    state.pendingLane = ''
    state.residentSince = 0
    state.minResidentUntil = 0
    state.idleSince = 0
    return true
  }

  /**
   * Explicitly gives a resident lane back to the pool when another trusted
   * surface temporarily owns passive observation of that exact conversation.
   * This is a handoff, so it intentionally bypasses the affinity dwell while
   * preserving non-preemptive/navigation safety and invalidating stale epochs.
   */
  releaseResidentLane(slotId, lane = '') {
    const state = this.register(slotId)
    const expected = String(lane || '').trim()
    if (!state.residentLane || state.nonPreemptive > 0 || state.navigationInProgress) return false
    if (expected && state.residentLane !== expected) return false
    state.assignmentEpoch += 1
    state.residentLane = ''
    state.pendingLane = ''
    state.residentSince = 0
    state.minResidentUntil = 0
    state.idleSince = 0
    return true
  }

  cancelAssignment(slotId, epoch) {
    const state = this.register(slotId)
    if (Number(epoch) !== state.assignmentEpoch) return false
    state.pendingLane = ''
    state.navigationInProgress = false
    return true
  }

  epochCurrent(slotId, epoch, lane = '') {
    const state = this.register(slotId)
    if (Number(epoch) !== state.assignmentEpoch) return false
    const expected = String(lane || '').trim()
    return !expected || expected === state.residentLane || expected === state.pendingLane
  }

  snapshot(slotId) {
    const state = this.register(slotId)
    return {
      slot_id: state.slotId,
      resident_lane: state.residentLane,
      resident_since: state.residentSince ? new Date(state.residentSince).toISOString() : '',
      min_resident_until: state.minResidentUntil ? new Date(state.minResidentUntil).toISOString() : '',
      assignment_epoch: state.assignmentEpoch,
      rotation_position: Math.max(0, this.rotation.indexOf(state.slotId)),
      navigation_in_progress: state.navigationInProgress,
      non_preemptive: state.nonPreemptive > 0,
      blocked: state.blocked === true,
      idle_since: state.idleSince ? new Date(state.idleSince).toISOString() : '',
    }
  }
}
