import { readFile } from 'node:fs/promises'

export async function expandPromptDispatchSource(main, sections) {
  const draft = await readFile(new URL('../../chatgpt/transport/requests/submission/draft.mjs', import.meta.url), 'utf8')
  const draftStart = draft.indexOf('  async function submitChatGPTDraft(')
  const draftEnd = draft.lastIndexOf('\n  return { submitChatGPTDraft }')
  const draftCompositionStart = main.indexOf('const promptDispatchDependencies = {')
  const draftCompositionEnd = main.indexOf('\nfunction durableWorkspaceChatID(', draftCompositionStart)
  const submissionIndex = await readFile(new URL('../../chatgpt/transport/requests/submission/index.mjs', import.meta.url), 'utf8')
  const dispatch = await readFile(new URL('../../chatgpt/transport/requests/wiring/desktop.mjs', import.meta.url), 'utf8')
  const dispatchIndex = await readFile(new URL('../../chatgpt/transport/requests/wiring/index.mjs', import.meta.url), 'utf8')
  const effortStart = dispatch.indexOf('  async function stepChatGPTReasoningEffortToward(')
  const effortEnd = dispatch.indexOf('\n  const { submitChatGPTDraft }', effortStart)
  if (draftStart < 0 || draftEnd <= draftStart || draftCompositionStart < 0 || draftCompositionEnd <= draftCompositionStart
      || effortStart < 0 || effortEnd <= effortStart || !submissionIndex.includes("from './draft.mjs'")
      || !dispatch.includes('createChatGPTDraftSubmission({')
      || !dispatch.includes('createChatGPTPromptTransport({')
      || !dispatchIndex.includes("from './desktop.mjs'")
      || !main.includes('createDesktopPromptDispatch(promptDispatchDependencies)')) {
    throw new Error('Prompt dispatch domain composition missing')
  }
  const bodies = await Promise.all(sections.map(async ([file, signature]) => {
    const module = await readFile(new URL(`../../chatgpt/transport/requests/${file}`, import.meta.url), 'utf8')
    const start = module.indexOf(`  ${signature}`)
    const end = module.lastIndexOf('\n  return {')
    if (start < 0 || end <= start) throw new Error(`Prompt source section missing: ${file}`)
    return module.slice(start, end).replace(/^  /gm, '').trim()
  }))
  const transport = await readFile(new URL('../../chatgpt/transport/index.mjs', import.meta.url), 'utf8')
  const requests = await readFile(new URL('../../chatgpt/transport/requests/index.mjs', import.meta.url), 'utf8')
  if (!main.includes("from './chatgpt/transport/index.mjs'")
      || !transport.includes('createDesktopPromptDispatch')
      || !requests.includes("from './wiring/index.mjs'")) {
    throw new Error('Prompt transport domain composition missing from main.mjs')
  }
  return `${main.slice(0, draftCompositionStart)}${[
    dispatch.slice(effortStart, effortEnd), draft.slice(draftStart, draftEnd), ...bodies,
  ].map((body) => body.replace(/^  /gm, '').trim()).join('\n\n')}\n${main.slice(draftCompositionEnd)}`
}
