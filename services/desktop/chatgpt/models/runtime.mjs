import { createChatGPTModelSelection } from './selection.mjs'
import { createChatGPTModelPreferences } from './preferences.mjs'

export function createDesktopChatGPTModels(d) {
  const selection = createChatGPTModelSelection(d)
  const preferences = createChatGPTModelPreferences(d.app.getPath('userData'))
  const assertIdle = (key, entry, allowedPreparationCount = 0, allowLoading = false) => {
    d.requireOwnedChatGPTEntry(key, entry)
    if (entry.role === 'worker' || (!allowLoading && entry.loading) || entry.externalAuthProvider || entry.authWindowOpen || entry.embeddedAuthActive || entry.humanAction?.active
      || Number(entry.transportPreparationCount || 0) !== allowedPreparationCount || entry.accountOperationActive || entry.conversationRequests?.size > 0
      || d.chatgptTransportModes.get(key) === 'manual' || d.expectedChatGPTBundles.has(key)
      || d.preparedChatGPTDrafts.has(key) || d.retryableChatGPTPrompts.has(key) || d.pendingChatGPTComments.has(key)
      || [...(d.pendingChatGPTBundleDeliveries?.values() || [])].some((record) => record.cacheKey === key)) {
      throw Object.assign(new Error('A escolha de modelo aguarda o pedido atual terminar e o Engine ficar disponível em transporte automático.'), { code: 'WHARNEX_CHATGPT_MODEL_BUSY' })
    }
  }
  async function operate(request, windowState, model) {
    const key = d.sanitizeChatCacheKey(request?.workspaceChatId)
    const { entry } = d.ensureChatGPTView(key, windowState)
    try {
      assertIdle(key, entry, 0, true)
      return await d.withChatGPTTransportPreparation(key, entry, '', async () => {
        // The preparation boundary serializes with writes; recheck after waiting.
        assertIdle(key, entry, 1, true)
        const requestedURL = request?.url ? d.canonicalChatGPTConversationURL(d.requireTrustedChatGPTURL(request.url)) : ''
        if (request?.url && !requestedURL) throw new Error('O controlo de modelos aceita apenas a conversa ChatGPT deste chat.')
        const wc = d.requireOwnedChatGPTEntry(key, entry).wc
        if (!wc.getURL() || wc.getURL() === 'about:blank') {
          await d.loadOwnedChatGPTURL(key, entry, requestedURL || d.CHATGPT_URL, 'model-inventory')
          await d.waitForChatGPTSurfaceReady(key, entry)
        } else if (entry.loading) await d.waitForChatGPTSurfaceReady(key, entry)
        assertIdle(key, entry, 1)
        if (!d.isTrustedChatGPTOrigin(wc.getURL())) throw new Error('O controlo de modelos requer o Engine ChatGPT carregado.')
        if (requestedURL && !d.sameConversationURL(wc.getURL(), requestedURL)) throw new Error('A conversa do Engine mudou; confirme o chat antes de escolher o modelo.')
        const result = model === undefined ? await selection.inventory(key, entry) : await selection.select(key, entry, model)
        if (model !== undefined) await preferences.set(key, result.current)
        console.log(`[chatgpt-model] key=${key} operation=${model === undefined ? 'inventory' : 'select'} options=${result.options.length}`)
        return result
      })
    } catch (error) {
      console.warn(`[chatgpt-model] key=${key} operation=${model === undefined ? 'inventory' : 'select'} failed=${String(error?.code || error?.name || 'unavailable').slice(0, 80)} state=${String(error?.state || '').slice(0, 80)}`)
      throw error
    }
  }
  const getChatGPTModels = (request, windowState) => operate(request, windowState)
  const setChatGPTModel = (request, windowState) => {
    const model = String(request?.model || '').trim()
    if (!model || model.length > 120 || /[\x00-\x1f\x7f]/.test(model)) {
      console.warn('[chatgpt-model] operation=select failed=model-identity-invalid')
      throw new Error('Modelo ChatGPT inválido.')
    }
    return operate(request, windowState, model)
  }
  const ensureSelectedChatGPTModel = async (key, entry, { allowChange = false } = {}) => {
    try {
      const preferred = await preferences.get(d.sanitizeChatCacheKey(key))
      if (!preferred) return undefined
      d.requireOwnedChatGPTEntry(key, entry)
      const result = await selection.ensure(key, entry, preferred, { allowChange })
      console.log(`[chatgpt-model] key=${key} request=${String(entry.transportRequestId || '').slice(0, 180)} operation=${allowChange ? 'preflight' : 'verify'} options=${result.options.length}`)
      return result
    } catch (error) {
      console.warn(`[chatgpt-model] key=${key} request=${String(entry.transportRequestId || '').slice(0, 180)} operation=verify failed=${String(error?.code || error?.name || 'unavailable').slice(0, 80)} state=${String(error?.state || '').slice(0, 80)}`)
      throw Object.assign(error, { retryTransport: false })
    }
  }
  return { getChatGPTModels, setChatGPTModel, ensureSelectedChatGPTModel }
}
