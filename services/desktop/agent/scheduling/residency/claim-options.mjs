// The durable claim options one Worker slot sends, derived from the residency
// of every slot in the pool.
export function residencyClaimOptions(state, slots, { rotationHead, dwellComplete, pinResident }) {
  // Only a peer that can actually serve its lane may reserve it. Excluding a
  // blocked peer's lane unconditionally made that peer a lane monopolist: an
  // interacting, navigating or loading slot kept every other slot out of a
  // conversation it could not work itself, so a due AWAIT_RESPONSE on that
  // conversation was claimable by nobody at all. The backend still owns
  // conflict safety through the per-conversation write lock and the lease, so
  // handing the lane to a free slot cannot overlap real work.
  const excludedLanes = slots
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
  const anotherFree = slots.some((candidate) => candidate.slotId !== state.slotId && !candidate.residentLane)
  return {
    preferred_lane: state.residentLane,
    excluded_lanes: excludedLanes,
    fallback_mode: !anotherFree && dwellComplete && rotationHead ? 'any' : 'resident_only',
  }
}
