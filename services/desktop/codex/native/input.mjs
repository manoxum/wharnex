import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decodeUserAttachment } from '../../security/input.mjs'

export async function prepareNativeInput(root, request) {
  const text = request.text
  if (typeof text !== 'string' || !text.trim() || text.length > 262144) throw new Error('Prompt Codex vazio ou demasiado longo.')
  const selected = [...(request.attachments || []), ...(request.artifacts || [])]
  if (selected.length > 64) throw new Error('Demasiados anexos Codex.')
  // Validate all input before writing; each request owns a fresh private folder.
  const files = selected.map((file) => decodeUserAttachment(file, 32 << 20))
  if (files.reduce((total, file) => total + file.bytes.length, 0) > 128 << 20) throw new Error('Os anexos Codex excedem 128 MiB.')
  const references = (request.projectFiles || []).map((value) => {
    if (typeof value !== 'string' || value.length > 1024 || path.isAbsolute(value) || value.includes('\0') || value.split(/[\\/]/).includes('..')) throw new Error('Referência de ficheiro Codex inválida.')
    return path.resolve(request.projectPath, value)
  })
  if (references.length > 1000) throw new Error('Demasiadas referências Codex.')
  const directory = path.join(root, 'attachments', request.requestId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const attachments = []
  for (const [index, file] of files.entries()) {
    const filename = path.join(directory, `${index + 1}-${file.name}`)
    await writeFile(filename, file.bytes, { flag: 'wx', mode: 0o600 })
    attachments.push({ name: file.name, path: filename, mime: file.mime })
  }
  const extra = []
  if (request.selfEvolution) extra.push('Modo Auto Evolution do Wharnex ativo: este pedido evolui o próprio Wharnex. Siga as instruções AGENTS.md e SoT do projeto ao implementar e verificar as alterações.')
  if (attachments.length) extra.push(`Anexos selecionados (ficheiros locais):\n${JSON.stringify(attachments)}`)
  if (references.length) extra.push(`Ficheiros selecionados:\n${JSON.stringify(references)}`)
  const input = [{ type: 'text', text: [text, ...extra].join('\n\n') }]
  for (const file of attachments) if (/^image\/(png|jpeg|webp|gif)$/.test(file.mime)) input.push({ type: 'localImage', path: file.path })
  return { input, attachments, references }
}
