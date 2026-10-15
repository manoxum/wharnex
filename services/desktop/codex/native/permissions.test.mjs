import test from 'node:test'
import assert from 'node:assert/strict'
import { nativePermissionPolicy } from './permissions.mjs'
import { prepareNativeInput } from './input.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('native permission levels map to official sandbox and approval reviewer contracts', () => {
  assert.equal(nativePermissionPolicy('ask').thread.approvalsReviewer, 'user')
  assert.equal(nativePermissionPolicy('ask').thread.approvalPolicy, 'on-request')
  assert.equal(nativePermissionPolicy('auto').turn.approvalsReviewer, 'auto_review')
  assert.equal(nativePermissionPolicy('auto').turn.sandboxPolicy.type, 'workspaceWrite')
  assert.equal(nativePermissionPolicy('full').turn.approvalPolicy, 'never')
  assert.equal(nativePermissionPolicy('full').turn.sandboxPolicy.type, 'dangerFullAccess')
  assert.throws(() => nativePermissionPolicy('sudo'), /inválido/)
})
test('Auto Evolution adds only the authoritative mode annotation alongside literal user input', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-evolution-')); t.after(() => rm(root, { recursive: true, force: true }))
  const request = { projectPath: '/project', requestId: 'req_native_evolution', text: 'Corrige isto.', attachments: [], projectFiles: [] }
  assert.equal((await prepareNativeInput(root, request)).input[0].text, request.text)
  const input = (await prepareNativeInput(root, { ...request, selfEvolution: true })).input[0].text
  assert.ok(input.startsWith(request.text)); assert.match(input, /Modo Auto Evolution/); assert.doesNotMatch(input, /\.zip|harness\.execution|base_context/)
})
