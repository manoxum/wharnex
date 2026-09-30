import { readFile } from 'node:fs/promises'

// Source-level transport tests follow the real input and renderer modules.
export async function expandPromptPreparationSource(main) {
  const input = await readFile(new URL('../../chatgpt/transport/requests/preparation/input.mjs', import.meta.url), 'utf8')
  const inputStart = input.indexOf('  async function materializeChatInput(')
  const inputEnd = input.lastIndexOf('\n  return { materializeChatInput,')
  const inputCompositionStart = main.indexOf('const {\n  materializeChatInput, materializeProtocolChatInput,')
  const inputCompositionEnd = main.indexOf('\nconst { executeChatGPTDOMScript, waitForChatGPTSurfaceReady } = createChatGPTRendererStability({', inputCompositionStart)
  const preparationIndex = await readFile(new URL('../../chatgpt/transport/requests/preparation/index.mjs', import.meta.url), 'utf8')
  if (inputStart < 0 || inputEnd <= inputStart || inputCompositionStart < 0
      || inputCompositionEnd <= inputCompositionStart || !preparationIndex.includes("from './input.mjs'")) {
    throw new Error('Chat input preparation domain composition missing from main.mjs')
  }
  main = `${main.slice(0, inputCompositionStart)}${input.slice(inputStart, inputEnd).replace(/^  /gm, '').trim()}\n${main.slice(inputCompositionEnd)}`
  const renderer = await readFile(new URL('../../chatgpt/session/views/renderer-stability.mjs', import.meta.url), 'utf8')
  const rendererStart = renderer.indexOf('  async function waitForChatGPTSurfaceReady(')
  const rendererEnd = renderer.lastIndexOf('\n  return { executeChatGPTDOMScript, waitForChatGPTSurfaceReady }')
  const rendererCompositionStart = main.indexOf('const { executeChatGPTDOMScript, waitForChatGPTSurfaceReady } = createChatGPTRendererStability({')
  const rendererCompositionEnd = main.indexOf('\nconst chatGPTAccountDependencies = {', rendererCompositionStart)
  const viewsIndex = await readFile(new URL('../../chatgpt/session/views/index.mjs', import.meta.url), 'utf8')
  if (rendererStart < 0 || rendererEnd <= rendererStart || rendererCompositionStart < 0
      || rendererCompositionEnd <= rendererCompositionStart || !viewsIndex.includes("from './renderer-stability.mjs'")) {
    throw new Error('ChatGPT renderer stability domain composition missing from main.mjs')
  }
  return `${main.slice(0, rendererCompositionStart)}${renderer.slice(rendererStart, rendererEnd).replace(/^  /gm, '').trim()}\n${main.slice(rendererCompositionEnd)}`
}
