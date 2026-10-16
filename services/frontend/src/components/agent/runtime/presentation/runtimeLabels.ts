export function short(value?: string, fallback = '—') {
  const text = String(value || '').trim()
  return text || fallback
}

export function timeLabel(value?: string) {
  const text = String(value || '').trim()
  if (!text) return '—'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString()
}

export function durationLabel(value?: number) {
  const ms = Math.max(0, Number(value || 0))
  if (!ms) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

export function memoryLabel(value?: number, available = true) {
  if (!available) return '—'
  const mib = Math.max(0, Number(value || 0)) / (1024 * 1024)
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`
  return `${mib >= 100 ? Math.round(mib) : mib.toFixed(1)} MiB`
}
