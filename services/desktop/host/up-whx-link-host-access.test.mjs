import test from 'node:test'
import assert from 'node:assert/strict'
import { hostAccessPorts } from './up-whx-link-host-access.mjs'

test('host access ports are opt-in, bounded and validated', () => {
  assert.deepEqual(hostAccessPorts({}), [])
  assert.deepEqual(hostAccessPorts({ WHARNEX_UP_LINK_HOST_PORTS: '443, 80,abc,0,70000,443' }), [80, 443])
})
