export function directChatGPTKey(projectPath: string) {
  let hash = 2166136261
  for (const char of projectPath) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `free_${(hash >>> 0).toString(16)}`
}
