// ChatGPT sometimes fails to fetch a conversation and renders, in place of the
// thread, a short notice with one "retry" control. The page has finished
// loading, yet it has no composer and no message turns, so every Worker action
// on it stalls until a person presses retry. The shape is recognised
// structurally — never by its localized text — and the only control it may
// press is the single enabled button in the main area outside header, nav and
// dialogs. Anything less certain asks the caller to reload instead.
const CONVERSATION_PATH = /^\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]{8,}/
const COMPOSER_SELECTORS = '#prompt-textarea,div[contenteditable="true"][data-testid*="composer"],div[contenteditable="true"][role="textbox"],textarea[placeholder]'

export function detectChatGPTConversationLoadFailure(doc, loc) {
  const none = { failed: false, loaded: false, retry: null }
  if (!CONVERSATION_PATH.test(String(loc?.pathname || ''))) return none
  if (doc?.readyState !== 'complete') return none
  // Loaded: the thread or the composer rendered. Only this clears a backoff.
  if (doc.querySelectorAll('[data-message-author-role]').length > 0) return { failed: false, loaded: true, retry: null }
  if (doc.querySelectorAll(COMPOSER_SELECTORS).length > 0) return { failed: false, loaded: true, retry: null }
  const main = doc.querySelector('main')
  if (!main) return none
  const visible = (node) => {
    const rect = node?.getBoundingClientRect?.()
    return Boolean(rect && rect.width > 0 && rect.height > 0)
  }
  const controls = [...main.querySelectorAll('button')].filter((button) => visible(button)
    && button.disabled !== true && button.getAttribute?.('aria-disabled') !== 'true'
    && !button.closest?.('header, nav, [role="dialog"]'))
  return { failed: true, loaded: false, retry: controls.length === 1 ? controls[0] : null }
}

export function chatGPTConversationLoadFailureScript(click = false) {
  return `(() => {
    const detect = ${detectChatGPTConversationLoadFailure.toString()};
    const CONVERSATION_PATH = ${CONVERSATION_PATH.toString()};
    const COMPOSER_SELECTORS = ${JSON.stringify(COMPOSER_SELECTORS)};
    const result = detect(document, location);
    const clicked = ${click === true} && Boolean(result.retry);
    if (clicked) result.retry.click();
    return { failed: result.failed, loaded: result.loaded, retryable: Boolean(result.retry), clicked };
  })()`
}
