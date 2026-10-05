// Defensive normalizers for timestamps, generations and durations that
// arrive from renderer events and persisted state.
export function finiteGeneration(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : 0
}

export function finiteOptionalTime(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export function finiteTime(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : Date.now()
}

export function boundedDuration(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return number
}
