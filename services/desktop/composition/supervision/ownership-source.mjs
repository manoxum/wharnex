import { readFile } from 'node:fs/promises'
import { readHealthSource } from '../session/health-source.mjs'
import { expandDesktopOwnershipSource } from '../session/ownership/source.mjs'

// Legacy composition tests inspect adjacent ownership and throttle logic.
// Rebuild that sequence from its domain modules and verify their facades.
export async function readOwnershipSource() {
  let main = await expandDesktopOwnershipSource(await readHealthSource())
  const throttle = await readFile(new URL('../../chatgpt/session/ownership/throttle.mjs', import.meta.url), 'utf8')
  const binding = await readFile(new URL('../../agent/supervision/ownership/binding.mjs', import.meta.url), 'utf8')
  const transport = await readFile(new URL('../../chatgpt/transport/requests/supervisor.mjs', import.meta.url), 'utf8')
  const routing = await readFile(new URL('../window/message-routing.mjs', import.meta.url), 'utf8')
  const windowIndex = await readFile(new URL('../window/index.mjs', import.meta.url), 'utf8')
  const chatSession = await readFile(new URL('../../chatgpt/session/index.mjs', import.meta.url), 'utf8')
  const agent = await readFile(new URL('../../agent/index.mjs', import.meta.url), 'utf8')
  const chatTransport = await readFile(new URL('../../chatgpt/transport/index.mjs', import.meta.url), 'utf8')
  if (!main.includes("from './chatgpt/session/index.mjs'") || !main.includes("from './agent/index.mjs'")
      || !main.includes("from './chatgpt/transport/index.mjs'")
      || !chatSession.includes("from './ownership/index.mjs'")
      || !agent.includes('createSupervisorOwnership')
      || !chatTransport.includes('createSupervisorTransport')
      || !main.includes("from '../../window/index.mjs'")
      || !windowIndex.includes("from './message-routing.mjs'")) {
    throw new Error('Ownership domain facades missing')
  }
  const throttleStart = throttle.indexOf('  function chatGPTArtifactExpectationArmed(')
  const throttleEnd = throttle.lastIndexOf('\n  return {')
  const bindingStart = binding.indexOf('  function chatGPTSupervisorOwnsExpectedResponse(')
  const bindingEnd = binding.lastIndexOf('\n  return {')
  const transportStart = transport.indexOf('  async function withChatGPTSupervisorTransport(')
  const transportEnd = transport.lastIndexOf('\n  return {')
  const sectionStart = main.indexOf('const {\n  chatGPTArtifactExpectationArmed,')
  const sectionEnd = main.indexOf('\nconst { abortChatGPTTransportPreparations', sectionStart)
  const transportCompositionStart = main.indexOf('const { withChatGPTSupervisorTransport } = createSupervisorTransport({', sectionEnd)
  const transportCompositionEnd = main.indexOf("compose(ctx, 'window-assembly'", transportCompositionStart)
  const routingStart = routing.indexOf('  function windowStateForWebContents(')
  const routingEnd = routing.lastIndexOf('\n  return {')
  if (Math.min(throttleStart, throttleEnd, bindingStart, bindingEnd, transportStart, transportEnd,
    sectionStart, sectionEnd, transportCompositionStart, transportCompositionEnd, routingStart, routingEnd) < 0) {
    throw new Error('Ownership domain composition missing')
  }
  const throttleBody = throttle.slice(throttleStart, throttleEnd).replace(/^  /gm, '').trim()
  const bindingBody = binding.slice(bindingStart, bindingEnd).replace(/^  /gm, '').trim()
  const reconcileStart = throttleBody.indexOf('function reconcileChatGPTThrottle(key, entry)')
  if (reconcileStart < 0) throw new Error('Throttle reconciliation missing')
  const ownershipBody = `${throttleBody.slice(0, reconcileStart).trim()}\n\n${bindingBody}\n\n${throttleBody.slice(reconcileStart)}`
  const supervisorTransport = transport.slice(transportStart, transportEnd).replace(/^  /gm, '').trim()
  const messageRouting = routing.slice(routingStart, routingEnd).replace(/^  /gm, '').trim()
  main = `${main.slice(0, transportCompositionStart)}${supervisorTransport}\n\n${messageRouting}\n${main.slice(transportCompositionEnd)}`
  return `${main.slice(0, sectionStart)}${ownershipBody}\n${main.slice(sectionEnd)}`
}
