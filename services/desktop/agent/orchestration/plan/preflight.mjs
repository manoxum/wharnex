export function prepareOrchestratorPlanTask(task, payload, {
  sanitizeSessionId, orchestratorDeliveryFor, orchestratorBundleFilename,
  orchestratorPlanFilename, canonicalChatGPTConversationURL,
}) {
  if (payload?.protocol !== 'harness.orchestrator-planning/v1') {
    return { failure: { status: 'failed', error: 'invalid orchestrator planning worker protocol payload' } }
  }
  const sessionId = sanitizeSessionId(task.session_id || payload.session_id)
  const requestId = String(task.request_id || payload.request_id || '').trim()
  const prompt = String(payload.prompt || '').trim()
  const includeContext = payload.include_context === true
  const contextMode = payload.context_mode === 'partial' ? 'partial' : 'full'
  const selectedContextPaths = Array.isArray(payload.context_paths) ? payload.context_paths : []
  const attachmentCacheKey = String(payload.attachment_cache_key || '').trim()
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
  const generatedAttachments = Array.isArray(payload.generated_attachments) ? payload.generated_attachments : []
  if (!/^orp_[A-Za-z0-9_-]{8,180}$/.test(requestId) || !prompt) {
    return { failure: { status: 'failed', error: 'orchestrator planning worker payload is incomplete' } }
  }
  if (attachments.length && !/^[A-Za-z0-9_-]{1,128}$/.test(attachmentCacheKey)) {
    return { failure: { status: 'failed', error: 'orchestrator planning attachment cache key is invalid' } }
  }
  if (generatedAttachments.length > 4) {
    return { failure: { status: 'failed', error: 'orchestrator generated attachment count is invalid' } }
  }
  // A checkpointed request keeps its legacy filename. New requests use the
  // project's standard response bundle.
  const checkpointFilename = String(payload.expected_filename || '').trim()
  const delivery = orchestratorDeliveryFor(checkpointFilename)
  const filename = delivery === 'bundle' ? orchestratorBundleFilename(requestId) : orchestratorPlanFilename(task.task_id)
  if (checkpointFilename && checkpointFilename !== filename) {
    return { failure: { status: 'failed', error: 'orchestrator planning checkpoint filename does not match its task' } }
  }
  return {
    sessionId, requestId, prompt, includeContext, contextMode,
    selectedContextPaths, attachmentCacheKey, attachments, generatedAttachments,
    delivery, filename,
    checkpointURL: canonicalChatGPTConversationURL(payload.conversation_url || ''),
    checkpointBaseline: Number(payload.assistant_baseline),
  }
}
