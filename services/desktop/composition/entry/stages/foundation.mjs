import { createCompositionContext, late, provide } from '../../context/context.mjs'
import { createDesktopBaseDependencies } from '../dependencies/index.mjs'
import { createOwnedBrowserShell } from '../../../browser/index.mjs'
import { createDesktopCompositionSettings } from '../../config/index.mjs'
import {
  createDesktopCollections, createDesktopRuntimeState, createDesktopStateAccessors,
  createRateLimitView, createAgentRuntimeView, createSupervisorNavigationView,
} from '../../state/index.mjs'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Every domain opens remote pages through the owned browser shell, never
// through Electron's native shell directly.
export function createDesktopContext(entryURL) {
  const { shell: nativeShell, ...base } = createDesktopBaseDependencies()
  const shell = createOwnedBrowserShell({ app: base.app, nativeShell })
  base.app.on('before-quit', shell.closeAll)
  const here = base.path.dirname(base.fileURLToPath(entryURL))
  return createCompositionContext({ ...base, shell, here, wait, fetch: globalThis.fetch })
}

export function composeFoundation(ctx) {
  provide(ctx, ctx.initializeDesktopIdentity({
    app: ctx.app, nativeImage: ctx.nativeImage, environment: process.env,
    consoleTarget: console, globalTarget: globalThis, requireLocalHTTPURL: ctx.requireLocalHTTPURL,
  }), 'identity')
  // Supervisor ownership and transport capture these helpers while they are
  // composed, so they exist before any domain stage runs.
  const urls = ctx.createChatGPTConversationURLs(ctx.requireTrustedChatGPTURL)
  provide(ctx, {
    chatGPTConversationID: urls.conversationID,
    chatAgentConversationID: urls.conversationID,
    canonicalChatGPTConversationURL: urls.canonicalURL,
    sameConversationURL: urls.sameConversation,
    chatAgentConversationURL: ctx.createChatAgentConversationURL(urls.canonicalURL),
  }, 'conversation-urls')
  provide(ctx, createDesktopCompositionSettings(), 'settings')
  composeRuntimeState(ctx)
}

function composeRuntimeState(ctx) {
  const publishers = late(ctx, 'publishChatAgentRuntimeState', 'publishChatGPTState')
  const desktopState = createDesktopRuntimeState({
    clipboard: ctx.clipboard, ClipboardItem: ctx.ClipboardItem,
    publishAgentState: publishers.publishChatAgentRuntimeState,
    publishChatGPTState: publishers.publishChatGPTState,
  })
  const accessors = createDesktopStateAccessors(desktopState)
  ctx.configureDesktopProcess({
    app: ctx.app, BrowserWindow: ctx.BrowserWindow, environment: process.env, platform: process.platform,
    processTarget: process, logger: console, getMainWindow: accessors.getMainWindow,
  })
  provide(ctx, {
    desktopState,
    rateLimitView: createRateLimitView(desktopState),
    agentRuntimeView: createAgentRuntimeView(desktopState),
    supervisorNavigationView: createSupervisorNavigationView(desktopState),
    ...accessors,
    ...createDesktopCollections(ctx.ProjectWindowRegistry),
  }, 'state')
  const deferred = late(ctx, 'chatAgentRuntimeState', 'sendToWindowState', 'refreshDesktopTray', 'persistChatAgentPolicies')
  provide(ctx, ctx.createChatAgentRuntimeControls({
    getRuntimeState: deferred.chatAgentRuntimeState,
    desktopWindows: ctx.desktopWindows,
    sendToWindowState: deferred.sendToWindowState,
    refreshDesktopTray: deferred.refreshDesktopTray,
    broadcastDelayMs: ctx.CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS,
    state: ctx.agentRuntimeView,
    normalizeChatAgentPolicies: ctx.normalizeChatAgentPolicies,
    persistChatAgentPolicies: deferred.persistChatAgentPolicies,
  }), 'runtime-controls')
}
