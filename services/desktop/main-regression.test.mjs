import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('prepare-prompt uses the background composer targeting helper', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function preparePromptForChatGPT(request)')
  const end = source.indexOf('\nasync function submitPreparedChatGPTDraft', start)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const preparePrompt = source.slice(start, end)
  assert.match(preparePrompt, /await targetChatGPTComposer\(key, request\?\.url \|\| '', request\?\.preferCurrentConversation === true\)/)
  assert.doesNotMatch(preparePrompt, /focusChatGPTComposer/)
})


test('manual toolbar send actions submit only after their upload is confirmed', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const contextStart = source.indexOf('async function attachContextToChatGPT(request)')
  const promptStart = source.indexOf('async function attachPromptToChatGPT(request)')
  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft', promptStart)

  assert.notEqual(contextStart, -1)
  assert.notEqual(promptStart, -1)
  assert.notEqual(preparedStart, -1)

  const contextSend = source.slice(contextStart, promptStart)
  const promptSend = source.slice(promptStart, preparedStart)
  for (const action of [contextSend, promptSend]) {
    const upload = action.indexOf('await pasteChatGPTFile')
    const submit = action.indexOf('await submitChatGPTDraft(key)')
    assert.notEqual(upload, -1)
    assert.notEqual(submit, -1)
    assert.ok(upload < submit)
    assert.match(action, /if \(!submission\.accepted\) throw new Error/)
  }
})


test('dual ChatGPT auth uses a real managed browser and never forwards an in-flight provider URL', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const routeStart = source.indexOf('function routeChatGPTNavigation(entry, event, url)')
  const routeEnd = source.indexOf('\nfunction observeEmbeddedAuthURL', routeStart)
  assert.notEqual(routeStart, -1)
  assert.notEqual(routeEnd, -1)
  const route = source.slice(routeStart, routeEnd)
  assert.match(route, /startExternalAuthentication\(entry, disposition\.provider \|\| 'OpenAI'\)/)
  assert.match(route, /disposition\.provider === 'Google'/)
  assert.doesNotMatch(route, /shell\.openExternal\(url\).*external-auth/s)

  const externalStart = source.indexOf('function startExternalAuthentication(entry, provider')
  const externalEnd = source.indexOf('\nfunction routeChatGPTNavigation', externalStart)
  const externalAuth = source.slice(externalStart, externalEnd)
  assert.match(externalAuth, /launchManagedBrowserAuth/)
  assert.match(externalAuth, /loginURL: CHATGPT_LOGIN_URL/)
  assert.doesNotMatch(externalAuth, /new BrowserWindow/)
})


test('bundle fallback snapshots assistant-turn baseline before each planner submit', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  const baseline = prepare.indexOf('await chatGPTAssistantTurnCount(target.wc)')
  const submit = prepare.indexOf('await submitChatGPTDraft(key)')
  const arm = prepare.indexOf('armExpectedChatGPTBundle(key, requestId, assistantBaseline)')
  assert.ok(baseline >= 0 && submit > baseline && arm > submit)

  const repairStart = source.indexOf('async function submitPromptToChatGPT')
  const repairEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', repairStart)
  const repair = source.slice(repairStart, repairEnd)
  assert.match(repair, /const assistantBaseline = await chatGPTAssistantTurnCount\(target\.wc\)/)
  assert.match(repair, /armExpectedChatGPTBundle\(key, requestId, assistantBaseline\)/)
})

test('external auth reuses the persistent Wharness browser profile and clear-session owns deletion', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const externalStart = source.indexOf('function startExternalAuthentication(entry, provider')
  const externalEnd = source.indexOf('\nfunction routeChatGPTNavigation', externalStart)
  assert.notEqual(externalStart, -1)
  assert.notEqual(externalEnd, -1)
  const externalAuth = source.slice(externalStart, externalEnd)
  assert.match(externalAuth, /const profileDir = managedAuthProfilePath\(\)/)
  assert.doesNotMatch(externalAuth, /app\.getPath\('temp'\)/)
  assert.doesNotMatch(externalAuth, /rm\(record\.profileDir/)

  const clearStart = source.indexOf('async function clearBrowserSession()')
  const clearEnd = source.indexOf('\nasync function desktopStorageUsage', clearStart)
  assert.notEqual(clearStart, -1)
  assert.notEqual(clearEnd, -1)
  assert.match(source.slice(clearStart, clearEnd), /rm\(managedAuthProfilePath\(\), \{ recursive: true, force: true/)
})
