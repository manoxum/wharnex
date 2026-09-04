export function remoteInputPayload(requestId, prompt, includeContext, attachments = [], artifacts = []) {
  const encode = (values) => (Array.isArray(values) ? values : []).map((item) => ({
    name: String(item?.name || ''),
    mime: String(item?.mime || ''),
    content_base64: String(item?.contentBase64 || ''),
  }))
  return {
    request_id: String(requestId || ''),
    prompt: String(prompt || ''),
    include_context: includeContext === true,
    attachments: encode(attachments),
    artifacts: encode(artifacts),
  }
}

export function parseRemoteInputResponse(status, result) {
  if (status === 409 && result?.error?.code === 'remote_storage_disabled') return null
  if (status < 200 || status >= 300) throw new Error(result?.error?.message || `Remote input HTTP ${status}`)
  const bootstrapPrompt = String(result?.bootstrap_prompt || '').trim()
  if (result?.mode !== 'remote_url' || !bootstrapPrompt || bootstrapPrompt.length > 16 * 1024) {
    throw new Error('Backend returned an invalid remote input bootstrap')
  }
  return { ...result, bootstrapPrompt }
}
