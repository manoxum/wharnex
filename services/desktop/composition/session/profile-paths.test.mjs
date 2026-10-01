import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createDesktopProfilePaths } from './index.mjs'

test('keeps browser data paths scoped to Desktop userData', () => {
  const profiles = createDesktopProfilePaths({
    app: { getPath: (name) => { assert.equal(name, 'userData'); return '/instance' } },
    path, managedBrowserProfileDirectory: (root) => path.join(root, 'managed-auth'),
  })
  assert.equal(profiles.chatGPTPartitionPath(), '/instance/Partitions/wharness-chatgpt')
  assert.equal(profiles.managedAuthProfilePath(), '/instance/managed-auth')
  assert.equal(profiles.pendingBrowserImportPath(), '/instance/.wharness-browser-session-import.whbs')
})
