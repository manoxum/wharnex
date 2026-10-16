export function artifactTypeLabel(name: string, contentType = '') {
  const extension = name.split('.').pop()?.trim().toUpperCase()
  if (extension && extension !== name.toUpperCase() && extension.length <= 6) return extension
  if (contentType.startsWith('image/')) return 'IMG'
  if (contentType.startsWith('video/')) return 'VÍDEO'
  if (contentType.startsWith('audio/')) return 'ÁUDIO'
  return 'FICHEIRO'
}

export function projectName(path: string) { return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path || 'Projeto' }

export function shortIdentifier(value: string, length = 18) { return value.length > length ? `${value.slice(0, length - 1)}…` : value }

export function formatBytes(value: number) { if (!Number.isFinite(value) || value <= 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const rank = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))); const amount = value / (1024 ** rank); const displayed = rank === 0 || Number.isInteger(amount) || amount >= 10 ? Math.round(amount) : amount.toFixed(1); return `${displayed} ${units[rank]}` }

export function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString() }
