export function remoteInputPayload(requestId, prompt, bootstrapText, includeContext, attachments = [], artifacts = [], projectFiles = []) {
  const encode = (values) => (Array.isArray(values) ? values : []).map((item) => ({
    name: String(item?.name || ''),
    mime: String(item?.mime || ''),
    content_base64: String(item?.contentBase64 || ''),
  }))
  return {
    request_id: String(requestId || ''),
    prompt: String(prompt || ''),
	bootstrap_text: String(bootstrapText || ''),
    include_context: includeContext === true,
    attachments: encode(attachments),
    artifacts: encode(artifacts),
    project_files: [...new Set((Array.isArray(projectFiles) ? projectFiles : []).map((path) => String(path || '').trim()).filter(Boolean))].slice(0, 32),
  }
}

export function parseRemoteInputResponse(status, result) {
  if (status === 409 && result?.error?.code === 'remote_storage_disabled') return null
  if (status < 200 || status >= 300) throw new Error(result?.error?.message || `Remote input HTTP ${status}`)
  const bootstrapPrompt = String(result?.bootstrap_prompt || '').trim()
  if (!['tunnel', 'remote_channel'].includes(result?.mode) || !bootstrapPrompt || bootstrapPrompt.length > 16 * 1024) {
    throw new Error('Backend returned an invalid remote input bootstrap')
  }
  const fallbackPrompt = String(result?.fallback_prompt || '').trim()
  if (fallbackPrompt.length > 16 * 1024) throw new Error('Backend returned an invalid remote input fallback')
  return { ...result, bootstrapPrompt, fallbackPrompt }
}
