import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('orchestrator planning carries shared-composer context and attachments into ChatGPT', async () => {
  const preflight = await readFile(new URL('./preflight.mjs', import.meta.url), 'utf8')
  const submission = await readFile(new URL('./submission.mjs', import.meta.url), 'utf8')
  const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8')

  assert.match(preflight, /const includeContext = payload\.include_context === true/)
  assert.match(submission, /storedAttachmentPath\(chatAttachmentRoot\(\), String\(attachment\?\.storage_ref \|\| ''\)\)/)
  assert.match(preflight, /const generatedAttachments = Array\.isArray\(payload\.generated_attachments\)/)
  assert.match(submission, /requestAttachments\.push\(\{ name, bytes \}\)/)
  assert.match(submission, /generatedAttachmentBytes > 2 \* 1024 \* 1024/)
  // Full sends the whole snapshot; Partial sends its maps plus only the files
  // the planner selected (adr/ADR-0083). Either way only when asked for.
  assert.match(submission, /const capturedContext = includeContext \? await fetchContextZip\(sessionId\) : undefined/)
  assert.match(submission, /const contextBytes = contextMode === 'full' \? capturedContext\?\.bytes : undefined/)
  assert.match(submission, /context: contextMode === 'partial' && capturedContext\s+\? \{ \.\.\.capturedContext, mode: 'partial', paths: flow\.selectedContextPaths \}/)
  assert.match(submission, /writeOrchestratorRequestBundle\(requestPath, \{/)
  assert.match(submission, /await pasteChatGPTFile\(target\.entry, requestPath, 1, 1, \{ pacedWorker \}\)/)
  assert.match(worker, /removeStoredChatAttachments\(chatAttachmentRoot\(\), attachmentCacheKey\)/)
})

test('an Orchestrator planning request bundle is kept like an agentic request bundle', async () => {
  const submission = await readFile(new URL('./submission.mjs', import.meta.url), 'utf8')
  assert.match(submission, /await persistChatArtifact\(sessionId, requestId, 'input', 'bundle', path\.basename\(requestPath\), 'application\/zip', await readFile\(requestPath\)\)/)
})
