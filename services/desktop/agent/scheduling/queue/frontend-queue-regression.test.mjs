import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const frontend = new URL('../../../../frontend/src/', import.meta.url)

async function source(path) { return readFile(new URL(path, frontend), 'utf8') }

async function expandedCSS(path) {
  const file = new URL(path, frontend)
  const content = await readFile(file, 'utf8')
  const imports = [...content.matchAll(/@import\s+['"]([^'"]+\.css)['"];?/g)]
  const children = await Promise.all(imports.map(async ([, relative]) => expandedCSS(new URL(relative, file).href)))
  return `${content}\n${children.join('\n')}`
}

test('composer separates queued main requests from Ctrl+Enter task comments and clears immediately', async () => {
  const panel = await source('components/chat/panel/ChatPanel.tsx')
  assert.match(panel, /if \(\(event\.ctrlKey \|\| event\.metaKey\) && taskInFlight\) void submitComment\(\)/)
  assert.match(panel, /else void submitMain\(\)/)
  assert.match(panel, /clearComposer\(\)\n    try \{ await onSend/)
  assert.match(panel, /Enter adiciona à fila · Ctrl\+Enter envia comentário/)
})

test('main request queue stays serialized behind active workflow and supports queue mutations', async () => {
  const app = `${await source('app/workspace/App.tsx')}\n${await source('app/chat/queueActions.ts')}`
  assert.match(app, /function enqueueMainRequest/)
  assert.match(app, /requestChainActive\(session\)/)
  assert.match(app, /queueDrainRef\.current/)
  assert.match(app, /function moveQueuedRequest/)
  assert.match(app, /function mergeQueuedRequest/)
  assert.match(app, /async function promoteQueuedRequest/)
})

test('clipboard images are uniquified before attachment de-duplication and send stays right aligned', async () => {
  const attachments = await source('lib/chat/attachments/chatAttachments.ts')
  const panel = await source('components/chat/panel/ChatPanel.tsx')
  const css = await expandedCSS('styles/legacy/styles.css')
  assert.match(attachments, /clipboard-image/)
  assert.match(panel, /uniquifyPastedChatFiles\(attachments, files(?:,\s*nextPromptIndex)?\)/)
  assert.match(css, /composer-submit-row.*grid-template-columns: minmax\(0, 1fr\) auto/s)
  assert.match(css, /send-button.*justify-self: end/s)
})

test('TODO and iteration artifacts are operational composer surfaces instead of decorative transcript icons', async () => {
  const panel = (await Promise.all([
    source('components/chat/panel/ChatPanel.tsx'),
    source('components/chat/panel/auxiliaryPanels.tsx'),
    source('components/chat/panel/chatItemView.tsx'),
    source('components/chat/panel/artifactControls.tsx'),
  ])).join('\n')
  assert.match(panel, /function TodoPanel/)
  assert.match(panel, /stripTodoSection\(item\.text\)/)
  assert.match(panel, /onClick=\{\(\) => onInspectArtifact\(kind\)\}/)
  assert.match(panel, /function ArtifactInspector/)
})

test('application controller owns Desktop ChatGPT affinity candidate validation', async () => {
  const pane = await source('components/chatgpt/surface/ChatGPTDesktopPane.tsx')
  const desktop = await source('lib/desktop/bridge/desktop.ts')
  const app = await source('app/workspace/App.tsx')
  assert.match(pane, /next\.cacheKey && next\.cacheKey !== chatIdRef\.current/)
  assert.doesNotMatch(pane, /next\.bindingCandidate/)
  assert.match(pane, /setBounds\(elementBounds\(hostRef\.current\), chatIdRef\.current\)/)
  assert.match(pane, /onPlanDownloaded\(\(\{ cacheKey,/)
  assert.doesNotMatch(pane, /onBundleDownloaded\(/)
  assert.match(app, /onBundleDownloaded\(\(bundle\) =>/)
  assert.match(pane, /chatgpt\.hide\(chatIdRef\.current\)/)
  assert.doesNotMatch(pane, /chatgptAutoBindingDecision|newChatSurfaceSeen/)
  assert.doesNotMatch(desktop, /chatgptAutoBindingDecision|isChatGPTNewChatURL/)
  assert.doesNotMatch(pane, /chatgpt\.(?:confirmAffinity|rejectAffinity)\(/)
  assert.match(app, /next\?\.bindingCandidate/)
  assert.match(app, /chatgpt\.confirmAffinity\(chatId, conversation\)/)
  assert.match(app, /chatgpt\.rejectAffinity\(chatId, conversation\)/)
})


test('background account lifecycle work has durable worker producers and no renderer retry loop', async () => {
  const app = `${await source('app/workspace/App.tsx')}\n${await source('app/chat/catalogActions.ts')}\n${await source('app/chat/activeChatLifecycleActions.ts')}`
  assert.match(app, /chatgpt\.queueArchive\(/)
  assert.match(app, /chatgpt\.queueRename\(/)
  assert.match(app, /chatgpt\.queueDelete\(/)
  assert.doesNotMatch(app, /async function runMaintenance\(\)/)
  assert.doesNotMatch(app, /chatgpt\.archiveConversation\(/)
  assert.doesNotMatch(app, /chatgpt\.organizeConversation\(/)
})

test('deferred Supervisor navigation exposes a local Engine cover while direct prompts queue', async () => {
  const pane = await source('components/chatgpt/surface/ChatGPTDesktopPane.tsx')
  const desktopTypes = await source('desktop/bridge.d.ts')
  const css = await expandedCSS('styles/legacy/styles.css')
  assert.match(desktopTypes, /surfaceDeferred\?: boolean/)
  assert.match(pane, /next\.surfaceDeferred/)
  assert.match(pane, /A preparar este chat/)
  assert.match(pane, /Pode enviar novos prompts agora/)
  assert.match(css, /\.desktop-chatgpt-deferred/)
})

test('agent runtime drawer inherits the Desktop bridge through the workspace iframe parent', async () => {
  const drawer = await source('components/agent/runtime/AgentRuntimeDrawer.tsx')
  assert.match(drawer, /import \{ desktopBridge, elementBounds \} from '\.\.\/\.\.\/\.\.\/lib\/desktop\/bridge\/desktop'/)
  assert.match(drawer, /const bridge = desktopBridge\(\)\?\.agents/)
  assert.doesNotMatch(drawer, /window\.wharnessDesktop\?\.agents/)
})

test('agent runtime exposes created browser instances for capture and explicit Worker interaction', async () => {
  const drawer = await source('components/agent/runtime/AgentRuntimeDrawer.tsx')
  const desktopTypes = await source('desktop/bridge/agents.d.ts')
  assert.match(drawer, /disabled=\{busy \|\| !selected\.browser\.available\}/)
  assert.doesNotMatch(drawer, /!selected\.browser\.url/)
  assert.match(drawer, /bridge\.openInteraction\(interactionId, interactionBounds\(host\)\)/)
  assert.match(drawer, /bridge\.closeInteraction\(interactionId\)/)
  assert.match(desktopTypes, /openInteraction\(agentId: string, bounds: DesktopBounds\)/)
  assert.match(desktopTypes, /setInteractionBounds\(agentId: string, bounds: DesktopBounds\)/)
  assert.match(desktopTypes, /closeInteraction\(agentId: string\)/)
})
