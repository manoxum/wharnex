export const worktreeKey = (repository: string, path: string) => `${repository}\u0000${path}`

export function splitWorktreeKey(key: string) {
  const index = key.indexOf('\u0000')
  return { repository: key.slice(0, index), path: key.slice(index + 1) }
}
