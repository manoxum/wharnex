const iso = (at) => (at ? new Date(at).toISOString() : '')

// The renderer-facing projection of one slot's residency.
export function residencySnapshot(state, rotationPosition) {
  return {
    slot_id: state.slotId,
    resident_lane: state.residentLane,
    resident_since: iso(state.residentSince),
    min_resident_until: iso(state.minResidentUntil),
    assignment_epoch: state.assignmentEpoch,
    rotation_position: rotationPosition,
    navigation_in_progress: state.navigationInProgress,
    non_preemptive: state.nonPreemptive > 0,
    blocked: state.blocked === true,
    idle_since: iso(state.idleSince),
  }
}
