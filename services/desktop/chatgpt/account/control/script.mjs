export function createAccountScript(context) {
  const {
    executeChatGPTDOMScript,
  } = context

  async function runChatGPTAccountScript(key, entry, stage, script) {
    const result = await executeChatGPTDOMScript(key, entry, `account-${stage}`, script)
    if (!result || typeof result !== 'object') return { ok: false, state: 'invalid-result' }
    return result
  }

  return { runChatGPTAccountScript }
}
