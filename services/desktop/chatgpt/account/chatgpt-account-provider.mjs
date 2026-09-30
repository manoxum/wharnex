export const CHATGPT_ACCOUNT_ACTIONS = Object.freeze(['ensure-project', 'move-conversation', 'rename-conversation', 'stop-conversation', 'archive-conversation', 'delete-conversation', 'hide-sidebar'])

export class ChatGPTAccountProviderChain {
  constructor({ official, browser }) {
    this.official = official
    this.browser = browser
  }

  async run(action, payload, browserFallback) {
    if (!CHATGPT_ACCOUNT_ACTIONS.includes(action)) throw new Error(`Unsupported ChatGPT account action: ${action}`)
    if (this.official?.supports?.(action) === true) return { ...(await this.official.run(action, payload)), provider: 'official-api' }
    const runBrowser = browserFallback || this.browser?.run?.bind(this.browser)
    if (!runBrowser) return { ok: false, state: 'unsupported', provider: 'none' }
    return { ...(await runBrowser(action, payload)), provider: 'typed-browser' }
  }
}
