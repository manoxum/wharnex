import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Local product configuration only; this never reads the remote partition.
export function createChatGPTModelPreferences(directory) {
  const filename = join(directory, 'wharnex-chat-models-v1.json')
  let state
  let writing = Promise.resolve()
  async function load() {
    if (!state) state = readFile(filename, 'utf8').then((text) => {
      if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Model preferences exceed local configuration limit')
      const parsed = JSON.parse(text)
      if (parsed.version !== 1 || !parsed.choices || Array.isArray(parsed.choices)) throw new Error('Invalid model preferences')
      return new Map(Object.entries(parsed.choices).slice(0, 512).filter(([key, model]) => /^[A-Za-z0-9_-]{1,128}$/.test(key) && typeof model === 'string' && model.length > 0 && model.length <= 120))
    }).catch((error) => {
      if (error.code === 'ENOENT') return new Map()
      throw error
    })
    return state
  }
  async function get(key) { return (await load()).get(key) || '' }
  async function set(key, model) {
    const previous = writing
    writing = previous.catch(() => undefined).then(async () => {
      const choices = await load()
      const next = new Map(choices)
      next.delete(key)
      next.set(key, model)
      while (next.size > 512) next.delete(next.keys().next().value)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = `${filename}.tmp`
      await writeFile(temporary, JSON.stringify({ version: 1, choices: Object.fromEntries(next) }), { mode: 0o600 })
      await rename(temporary, filename)
      state = Promise.resolve(next)
    })
    return writing
  }
  return { get, set }
}
