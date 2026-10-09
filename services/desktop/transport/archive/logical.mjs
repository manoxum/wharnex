import { writeChatInputZip } from '../chat-input-zip-writer.mjs'
import { contextArchiveEntries, contextRootsManifest, CONTEXT_ROOTS_NOTICE, PRIMARY_CONTEXT_ROOT } from './context-roots.mjs'
import { normalizeContinuationFiles } from './continuation.mjs'
import { gitContextArchiveEntries, gitContextManifest, normalizeGitContextSnapshot } from './git-context.mjs'
import { knowledgeArchiveEntries, knowledgeManifest, normalizeKnowledgeSnapshot, promptWithKnowledgeContract } from './knowledge.mjs'
import { normalizeRequestMetadata, requestMetadataBlock } from './request-identity.mjs'

const PROMPT_PATH = 'prompt/wharness-planner-prompt.md'
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')

function plannerPrompt(prompt, metadata, context, knowledge) {
  const text = String(prompt || '').trimEnd()
  if (!text) throw new Error('Prepared prompt is empty')
  const withRoots = `${requestMetadataBlock(metadata)}\n\n${text}${context?.bytes ? `\n\n${CONTEXT_ROOTS_NOTICE}` : ''}`
  return promptWithKnowledgeContract(withRoots, knowledge)
}

function projectFilesEntry(paths) {
  return {
    name: 'references/project-files.json',
    bytes: json({ paths, instruction: 'Treat these paths as explicit user-selected references. Their authoritative contents are inside the context/ directory.' }),
  }
}

// Writes the one logical request archive: the transport manifest, the planner
// prompt, and every input the exchange needs (adr/ADR-0052).
export async function writeChatInputArchive(targetPath, {
  requestId, requestMetadata, prompt, context, knowledge, gitContext,
  continuation = [], attachments = [], artifacts = [], projectFiles = [], signal,
}) {
  const metadata = normalizeRequestMetadata(requestMetadata, requestId)
  const knowledgeSnapshot = normalizeKnowledgeSnapshot(knowledge)
  const promptText = plannerPrompt(prompt, metadata, context, knowledgeSnapshot)
  const gitContextSnapshot = normalizeGitContextSnapshot(gitContext)
  const selectedPaths = [...new Set(projectFiles.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 32)
  const continuationFiles = normalizeContinuationFiles(continuation)
  const contextEntries = contextArchiveEntries(context)
  const partial = context?.mode === 'partial'
  const manifest = {
    protocol: 'wharness.chat-input/v1',
    request_id: String(requestId || ''),
    request_metadata: metadata,
    prompt: PROMPT_PATH,
    context_included: Boolean(context?.bytes),
    context_mode: partial ? 'partial' : 'full',
    context_paths: partial ? context.paths || [] : [],
    context_root: context?.bytes ? PRIMARY_CONTEXT_ROOT : '',
    context_roots: contextRootsManifest(Boolean(context?.bytes)),
    project_files: selectedPaths,
    git_context: gitContextManifest(gitContextSnapshot),
    knowledge: knowledgeManifest(knowledgeSnapshot),
    continuation: continuationFiles.map((entry) => ({ path: entry.name, bytes: entry.bytes.byteLength })),
    // Requests never carry tunnel endpoints; the field stays for schema compatibility (adr/ADR-0074).
    live_tunnels: [],
  }
  const entries = [
    { name: 'transport.json', bytes: json(manifest) },
    { name: PROMPT_PATH, bytes: Buffer.from(`${promptText}\n`, 'utf8') },
    ...knowledgeArchiveEntries(knowledgeSnapshot),
    ...continuationFiles,
    ...gitContextArchiveEntries(gitContextSnapshot),
    ...contextEntries,
    ...(selectedPaths.length ? [projectFilesEntry(selectedPaths)] : []),
    ...artifacts.map((artifact) => ({ name: `artifacts/${artifact.name}`, bytes: artifact.bytes })),
    ...attachments.map((attachment) => ({ name: `attachments/${attachment.name}`, bytes: attachment.bytes })),
  ]
  const bytes = await writeChatInputZip(targetPath, entries, signal)
  return { bytes, fileCount: entries.length, requestMetadata: metadata }
}
