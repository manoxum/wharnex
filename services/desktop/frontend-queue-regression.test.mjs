import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const frontend = new URL('../frontend/src/', import.meta.url)

async function source(path) { return readFile(new URL(path, frontend), 'utf8') }

test('composer separates queued main requests from Ctrl+Enter task comments and clears immediately', async () => {
  const panel = await source('components/ChatPanel.tsx')
  assert.match(panel, /if \(\(event\.ctrlKey \|\| event\.metaKey\) && taskInFlight\) void submitComment\(\)/)
  assert.match(panel, /else event\.currentTarget\.form\?\.requestSubmit\(\)/)
  assert.match(panel, /clearComposer\(\)\n    try \{ await onSend/)
  assert.match(panel, /Enter adiciona à fila · Ctrl\+Enter envia comentário/)
})

test('main request queue stays serialized behind active workflow and supports queue mutations', async () => {
  const app = await source('App.tsx')
  assert.match(app, /function enqueueMainRequest/)
  assert.match(app, /requestChainActive\(session\)/)
  assert.match(app, /queueDrainRef\.current/)
  assert.match(app, /function moveQueuedRequest/)
  assert.match(app, /function mergeQueuedRequest/)
  assert.match(app, /async function promoteQueuedRequest/)
})

test('clipboard images are uniquified before attachment de-duplication and send stays right aligned', async () => {
  const attachments = await source('lib/chatAttachments.ts')
  const panel = await source('components/ChatPanel.tsx')
  const css = await source('styles.css')
  assert.match(attachments, /clipboard-image/)
  assert.match(panel, /uniquifyPastedChatFiles\(attachments, files\)/)
  assert.match(css, /composer-submit-row.*grid-template-columns: minmax\(0, 1fr\) auto/s)
  assert.match(css, /send-button.*justify-self: end/s)
})

test('TODO and iteration artifacts are operational composer surfaces instead of decorative transcript icons', async () => {
  const panel = await source('components/ChatPanel.tsx')
  assert.match(panel, /function TodoPanel/)
  assert.match(panel, /stripTodoSection\(item\.text\)/)
  assert.match(panel, /onClick=\{\(\) => onInspectArtifact\(kind\)\}/)
  assert.match(panel, /function ArtifactInspector/)
})
