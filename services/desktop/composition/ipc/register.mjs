import { registerWindowDomainIPC } from './window.mjs'
import { registerChatGPTDomainIPC } from './chatgpt.mjs'
import { registerAgentDomainIPC } from './agent.mjs'
import { registerBrowserDomainIPC } from './browser.mjs'
import { registerAttachmentsDomainIPC } from './attachments.mjs'
import { registerClipboardDomainIPC } from './clipboard.mjs'
import { registerUITestingDomainIPC } from './uitesting.mjs'

export function registerDesktopIPC({ common, window, chatgpt, agent, browser, attachments, clipboard, uitesting }) {
  registerWindowDomainIPC(common, window)
  registerChatGPTDomainIPC(common, chatgpt)
  registerAgentDomainIPC(common, agent)
  registerBrowserDomainIPC(common, browser)
  registerAttachmentsDomainIPC(common, attachments)
  registerClipboardDomainIPC(common, clipboard)
  registerUITestingDomainIPC(common, uitesting)
}
