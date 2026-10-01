import { createAuthNotifications } from './notifications.mjs'
import { createManagedAuthentication } from './managed.mjs'
import { createAuthNavigation } from './navigation.mjs'
export { createEmbeddedChatGPTAuthentication } from './embedded.mjs'

export function createChatGPTAuthentication(options) {
  const notifications = createAuthNotifications(options)
  const managed = createManagedAuthentication({ ...options, ...notifications })
  return {
    ...notifications,
    ...managed,
    routeChatGPTNavigation: createAuthNavigation({
      chatGPTNavigationDisposition: options.chatGPTNavigationDisposition,
      startExternalAuthentication: managed.startExternalAuthentication,
      shell: options.shell,
    }),
  }
}
