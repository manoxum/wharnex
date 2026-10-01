import { createSupervisorSurfaceSlots } from '../slots.mjs'
import { createSupervisorSurfaceVisibility } from '../visibility.mjs'
import { createSupervisorSurfaceNavigation } from '../navigation.mjs'

export function createDesktopSupervisorSurfaces(d) {
  const slots = createSupervisorSurfaceSlots({
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    chatgptViews: d.chatgptViews,
    cancelExternalAuthentication: d.cancelExternalAuthentication,
    windowStateForEntry: d.windowStateForEntry,
    desktopWindows: d.desktopWindows,
    getDesiredChatAgentSupervisorSlots: d.getDesiredChatAgentSupervisorSlots,
    supervisorBindingHeld: d.supervisorBindingHeld,
    createChatGPTView: d.createChatGPTView,
    requireOwnedChatGPTEntry: d.requireOwnedChatGPTEntry,
    touchChatGPTEntry: d.touchChatGPTEntry,
    chatGPTEntryIsActiveVisible: d.chatGPTEntryIsActiveVisible,
  })
  const visibility = createSupervisorSurfaceVisibility({
    chatgptViews: d.chatgptViews,
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    windowStateForEntry: d.windowStateForEntry,
    ensureChatGPTView: slots.ensureChatGPTView,
    activeChatGPTEntry: d.activeChatGPTEntry,
    reconcileChatGPTThrottle: d.reconcileChatGPTThrottle,
    setChatGPTBounds: d.setChatGPTBounds,
    touchChatGPTEntry: d.touchChatGPTEntry,
    evictIdleChatGPTViews: slots.evictIdleChatGPTViews,
    publishChatGPTState: d.publishChatGPTState,
  })
  const navigation = createSupervisorSurfaceNavigation({
    navigationState: d.navigationState,
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    supervisorEntry: slots.supervisorEntry,
    supervisorKey: slots.supervisorKey,
    chatgptViews: d.chatgptViews,
    reconcileChatGPTThrottle: d.reconcileChatGPTThrottle,
    chatGPTKeyForEntry: d.chatGPTKeyForEntry,
    sendToWindowState: d.sendToWindowState,
    currentChatGPTState: d.currentChatGPTState,
    supervisorSurfaceRoute: d.supervisorSurfaceRoute,
    reusableSupervisor: slots.reusableSupervisor,
    getDesiredChatAgentSupervisorSlots: d.getDesiredChatAgentSupervisorSlots,
    activateChatGPTView: visibility.activateChatGPTView,
    requireTrustedChatGPTURL: d.requireTrustedChatGPTURL,
    CHATGPT_URL: d.CHATGPT_URL,
    sameConversationURL: d.sameConversationURL,
    loadOwnedChatGPTURL: d.loadOwnedChatGPTURL,
    chatGPTSurfaceShouldBeVisible: visibility.chatGPTSurfaceShouldBeVisible,
    flushQueuedChatGPTComments: (...args) => d.flushQueuedChatGPTComments(...args),
    DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS: d.DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS,
  })
  return { ...slots, ...visibility, ...navigation }
}
