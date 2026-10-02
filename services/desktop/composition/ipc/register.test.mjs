import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopIPCRegistrar, registerDesktopIPC } from './index.mjs'

test('desktop IPC domains register in the original order with live state callbacks', () => {
  const order = []
  const options = new Map()
  const capture = (name) => (value) => { order.push(name); options.set(name, value) }
  const handlers = {
    window: ['registerWindowIPC', 'registerDesktopShellIPC', 'registerSpellcheckIPC'],
    chatgpt: ['registerChatGPTSurfaceIPC', 'registerChatGPTAccountIPC', 'registerChatGPTSessionControlIPC',
      'registerExpectedBundleRecoveryIPC', 'registerChatGPTBundleIPC', 'registerChatGPTPromptIPC'],
    agent: ['registerAgentIPC'],
    browser: ['registerBrowserDataIPC'],
    attachments: ['registerChatAttachmentIPC'],
    clipboard: ['registerClipboardIPC'],
  }
  const context = {
    common: { ipcMain: { id: 'ipc' }, trustedSender: () => undefined },
  }
  for (const [domain, names] of Object.entries(handlers)) {
    context[domain] = Object.fromEntries(names.map((name) => [name, capture(name)]))
  }
  const state = { get supervisorSlots() { return 6 } }
  const getScheduler = () => ({ id: 'scheduler' })
  context.agent.state = state
  context.chatgpt.CHATGPT_URL = 'https://chatgpt.com/'
  context.chatgpt.CHATGPT_LOGIN_URL = 'https://chatgpt.com/auth/login'
  context.chatgpt.shell = { openExternal: async () => {} }
  context.chatgpt.BEHAVIOR_PROBE_CONTROLS = ['closed-control']
  context.chatgpt.getChatAgentScheduler = getScheduler

  registerDesktopIPC(context)

  assert.deepEqual(order, Object.values(handlers).flat())
  for (const value of options.values()) {
    assert.equal(value.ipcMain, context.common.ipcMain)
    assert.equal(value.trustedSender, context.common.trustedSender)
  }
  assert.equal(options.get('registerChatGPTSurfaceIPC').homeURL, context.chatgpt.CHATGPT_URL)
  assert.equal(options.get('registerChatGPTAccountIPC').behaviorProbeControls, context.chatgpt.BEHAVIOR_PROBE_CONTROLS)
  assert.equal(options.get('registerChatGPTSessionControlIPC').loginURL, context.chatgpt.CHATGPT_LOGIN_URL)
  assert.equal(options.get('registerChatGPTSessionControlIPC').openOwnedChatGPTBrowser, context.chatgpt.shell.openExternal)
  assert.equal(options.get('registerExpectedBundleRecoveryIPC').getChatAgentScheduler, getScheduler)
  assert.equal(options.get('registerAgentIPC').state, state)
})

test('entrypoint registrar delays IPC setup and passes live agent state', () => {
  const order = []
  const names = [
    'registerWindowIPC', 'registerDesktopShellIPC', 'registerSpellcheckIPC',
    'registerChatGPTSurfaceIPC', 'registerChatGPTAccountIPC',
    'registerChatGPTSessionControlIPC', 'registerExpectedBundleRecoveryIPC',
    'registerChatGPTBundleIPC', 'registerChatGPTPromptIPC',
    'registerAgentIPC', 'registerBrowserDataIPC',
    'registerChatAttachmentIPC', 'registerClipboardIPC',
  ]
  const state = { get scheduler() { return 'live' } }
  const d = Object.fromEntries(names.map((name) => [name, (options) => order.push([name, options])]))
  Object.assign(d, { ipcMain: {}, trustedSender: () => undefined, agentState: state, shell: { openExternal: async () => {} } })
  const registerIPC = createDesktopIPCRegistrar(d)
  assert.deepEqual(order, [])
  registerIPC()
  assert.deepEqual(order.map(([name]) => name), names)
  assert.equal(order.find(([name]) => name === 'registerAgentIPC')[1].state, state)
})
