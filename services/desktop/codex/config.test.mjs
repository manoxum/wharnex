import test from 'node:test'
import assert from 'node:assert/strict'
import { plannerConfiguration } from './config.mjs'

test('literal MCP and plugin names are disabled without dotted-key ambiguity', () => {
  const config = plannerConfiguration({ mcp_servers: { 'server.with.dots': { command: 'host-tool' } }, plugins: { 'plugin.with.dots@source': {} } })
  assert.deepEqual(config.mcp_servers, { 'server.with.dots': { enabled: false } })
  assert.deepEqual(config.plugins, { 'plugin.with.dots@source': { enabled: false } })
  for (const name of ['shell_tool', 'unified_exec', 'hooks', 'plugins', 'view_image', 'image_generation', 'goals', 'multi_agent_v2']) assert.equal(config[`features.${name}`], false)
  assert.equal(config['features.skip_host_skill_discovery'], true)
  assert.equal(config['features.code_mode_host'], true)
})
