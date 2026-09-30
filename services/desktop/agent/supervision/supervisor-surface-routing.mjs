function clean(value) {
  return String(value || '').trim()
}

export function publicSupervisorId(entry) {
  const slotId = clean(entry?.slotId)
  return /^supervisor-[1-9][0-9]*$/.test(slotId) ? slotId : ''
}

export function supervisorSurfaceRoute({
  targetKey,
  supervisors = [],
  capacity = 0,
  reusableKey = '',
  activeTransportKey = '',
  activeTransportSlotId = '',
} = {}) {
  const key = clean(targetKey)
  const entries = supervisors.map((entry) => ({
    key: clean(entry?.key),
    slotId: clean(entry?.slotId),
  })).filter((entry) => entry.key)

  const resident = entries.find((entry) => entry.key === key)
  if (resident) return { deferred: false, reason: 'resident', supervisorId: resident.slotId }
  if (entries.length < Math.max(1, Number(capacity) || 1)) return { deferred: false, reason: 'free-slot', supervisorId: '' }
  const reusable = entries.find((entry) => entry.key === clean(reusableKey))
  if (reusable) return { deferred: false, reason: 'reusable-slot', supervisorId: reusable.slotId }
  // A transport on another renderer matters only after the target proves it
  // needs one of the already-held physical slots. Resident, free and reusable
  // slots above remain independently accessible.
  if (clean(activeTransportKey)) {
    return {
      deferred: true,
      reason: 'transport',
      competingKey: clean(activeTransportKey),
      competingSupervisorId: clean(activeTransportSlotId),
    }
  }
  return { deferred: true, reason: 'capacity-held', competingKey: '', competingSupervisorId: '' }
}
