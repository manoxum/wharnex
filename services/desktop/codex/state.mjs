import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createCodexState(root) {
  const filename = path.join(root, 'bindings.json')
  let records
  let writes = Promise.resolve()
  async function load() {
    if (!records) {
      try { records = JSON.parse(await readFile(filename, 'utf8')) } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('Estado Codex ilegível; preserve o ficheiro e recupere o estado antes de reenviar.')
        records = []
      }
      if (!Array.isArray(records)) throw new Error('Estado Codex inválido.')
    }
    return records
  }
  async function save(record) {
    const operation = writes.then(async () => {
      const list = await load()
      const index = list.findIndex((item) => item.projectPath === record.projectPath && item.chatId === record.chatId)
      if (index >= 0) list[index] = record
      else list.push(record)
      await mkdir(root, { recursive: true, mode: 0o700 })
      await writeFile(`${filename}.tmp`, JSON.stringify(list), { mode: 0o600 })
      await rename(`${filename}.tmp`, filename)
    })
    writes = operation.catch(() => {})
    return operation
  }
  return { load, save, root }
}
