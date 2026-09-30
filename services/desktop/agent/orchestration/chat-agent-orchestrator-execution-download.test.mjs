import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerOrchestratorExecutionDownload } from './chat-agent-orchestrator-execution-download.mjs'

test('only the armed Orchestrator Agent bundle reaches its Worker', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-orchestrator-download-'))
  const filename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'
  const expectedDownloads = new Map()
  let resolveDownload
  let rejectDownload
  const received = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
  expectedDownloads.set(filename, { taskId: 'cat_0123456789abcdef0123', resolve: resolveDownload, reject: rejectDownload })
  const item = new EventEmitter()
  item.getTotalBytes = () => 3
  item.getReceivedBytes = () => 3
  item.setSavePath = (value) => { item.savePath = value }
  item.cancel = () => { throw new Error('the expected download was cancelled') }
  try {
    assert.equal(registerOrchestratorExecutionDownload(item, 'unrelated.zip', expectedDownloads, root), false)
    assert.equal(registerOrchestratorExecutionDownload(item, filename.replace('.zip', ' (2).zip'), expectedDownloads, root), true)
    assert.equal(item.savePath.endsWith(filename), true)
    await writeFile(item.savePath, Buffer.from('ZIP'))
    item.emit('done', {}, 'completed')
    assert.equal((await received).toString(), 'ZIP')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
