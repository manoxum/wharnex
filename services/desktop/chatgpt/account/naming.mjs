// Wharnex-owned names on the ChatGPT account: conversation titles carry the
// WHX prefix, and project names are compared folded.
export function normalizeWHXTitle(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim().replace(/^WHX:\s*/i, '')
  const title = compact.slice(0, 80) || 'New task'
  return `WHX: ${title}`
}

export function normalizeChatGPTProjectName(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return 'Wharnex'
  return compact.slice(0, 80)
}

// ChatGPT project names are compared case-insensitively and whitespace-folded
// before an exact match decides "exists" vs "create". Creating a second
// "Wharnex" next to an existing "wharnex" is the duplication this prevents.
export function sameChatGPTProjectName(left, right) {
  return normalizeChatGPTProjectName(left).toLocaleLowerCase() === normalizeChatGPTProjectName(right).toLocaleLowerCase()
}
