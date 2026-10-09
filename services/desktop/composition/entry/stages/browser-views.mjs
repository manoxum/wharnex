import { compose, late, provide } from '../../context/context.mjs'
import { createDesktopAuthViewRuntime } from '../../session/index.mjs'
import { createBrowserHost } from '../../../window/lifecycle/browser-monitor.mjs'
import { createWindowLater } from './ownership.mjs'

export function composeBrowserViews(ctx) {
  // The browser monitor window physically hosts every ChatGPT agent view.
  const browserHost = createBrowserHost({
    BrowserWindow: ctx.BrowserWindow, View: ctx.View, windows: ctx.desktopWindows, createWindow: createWindowLater(ctx),
  })
  provide(ctx, { browserHost }, 'browser-host')
  compose(ctx, 'auth-views', createDesktopAuthViewRuntime, {
    ...late(ctx, 'chatGPTSurfaceShouldBeVisible', 'grantChatGPTLayoutViewport'),
    getDownloadPoller: () => ctx.pollExpectedChatGPTDownloadKey,
    getHideChatGPTSidebar: () => ctx.hideChatGPTSidebar,
    getHideChatAgentInteractionEntry: () => ctx.hideChatAgentInteractionEntry,
  })
}
