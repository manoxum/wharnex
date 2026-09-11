export const DEFAULT_CHAT_AGENT_RESIDENCY_MS = 60_000
export const MIN_CHAT_AGENT_RESIDENCY_MS = 30_000
export const MAX_CHAT_AGENT_RESIDENCY_MS = 120_000
export const CHAT_AGENT_NAVIGATION_GAP_MS = 30_000
export const CHAT_AGENT_AWAIT_PROBE_MS = 30_000

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

export class ChatAgentResidency {
  constructor({ minResidenceMs = DEFAULT_CHAT_AGENT_RESIDENCY_MS, now = () => Date.now() } = {}) {
    this.minResidenceMs = normalizeResidence(minResidenceMs)
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

  claimOptions(slotId, { blocked = false } = {}) {
    const state = this.register(slotId)
    if (blocked || state.nonPreemptive > 0 || state.navigationInProgress) return { skip: true }
    const excludedLanes = [...this.slots.values()]
      .filter((candidate) => candidate.slotId !== state.slotId && candidate.residentLane)
      .map((candidate) => candidate.residentLane)
    if (!state.residentLane) {
      return { preferred_lane: '', excluded_lanes: excludedLanes, fallback_mode: 'unresident_only' }
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
    if (!changed) return true
    state.residentLane = target
    state.residentSince = settledAt
    state.minResidentUntil = settledAt + this.minResidenceMs
    this.rotation = this.rotation.filter((candidate) => candidate !== state.slotId)
    this.rotation.push(state.slotId)
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
    }
  }
}
