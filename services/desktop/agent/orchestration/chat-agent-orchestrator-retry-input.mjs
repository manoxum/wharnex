export async function orchestratorRetryInput(task, readAttachment) {
  const context = task?.retry_context
  if (!context) return { attachments: [], projectFiles: [] }
  const files = Array.isArray(context.project_files) ? context.project_files : []
  const records = Array.isArray(context.attachments) ? context.attachments : []
  const cacheKey = String(context.attachment_cache_key || '')
  if (files.length > 128 || records.length > 20 || (records.length && !/^[A-Za-z0-9_-]{1,128}$/.test(cacheKey))) {
    throw new Error('Orchestrator retry context is invalid')
  }
  const attachments = []
  for (const record of records) {
    const ref = String(record?.storage_ref || '')
    if (!ref.startsWith(`${cacheKey}/`)) throw new Error('Orchestrator retry attachment belongs to another context')
    const file = await readAttachment(ref)
    if (file.name !== record.name || Buffer.from(file.contentBase64, 'base64').byteLength !== Number(record.size)) {
      throw new Error('Orchestrator retry attachment changed after selection')
    }
    attachments.push(file)
  }
  return { attachments, projectFiles: files }
}
