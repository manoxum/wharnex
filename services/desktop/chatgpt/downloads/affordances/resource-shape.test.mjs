import test from 'node:test'
import assert from 'node:assert/strict'
import { describeOwnedResourceShape, normalizeOwnedResourceShape } from './resource-shape.mjs'

const expected = 'whx_bundle_res_owned_req_current.zip'
function fixture(labelText) {
  const label = { children: [], textContent: labelText, closest: () => null, getAttribute: () => null }
  const card = { tagName: 'DIV', closest: () => null, getAttribute: () => null, querySelectorAll: () => [label] }
  const shallow = { tagName: 'BUTTON', contains: () => false, parentElement: null }
  const main = { tagName: 'MAIN', contains: () => true }
  shallow.parentElement = main
  const document = { querySelector: () => main, querySelectorAll: () => [card] }
  return { document, nodes: [], markers: [{ parentElement: shallow }], card }
}

test('resource filename labels distinguish the expected request from an older response of the same chat', () => {
  const f = fixture('whx_bundle_res_owned_req_older.zip')
  const result = describeOwnedResourceShape(f.document, f.nodes, f.markers, expected)
  assert.equal(result.sameChat, 1)
  assert.equal(result.sameRequest, 0)
  assert.equal(result.expected, 0)
  assert.equal(result.markerAncestors[0].cards, 0)
  assert.equal(result.markerAncestors[1].cards, 1)
  assert.doesNotMatch(JSON.stringify(result), /whx_bundle|req_older/)
})

test('resource diagnosis never reads prose outside the structural filename-label boundary', () => {
  const f = fixture(expected)
  Object.defineProperty(f.card, 'textContent', { get() { throw new Error('card prose must not be read') } })
  const result = describeOwnedResourceShape(f.document, f.nodes, f.markers, expected)
  assert.equal(result.expected, 1)
  assert.equal(result.sameRequest, 1)
  assert.doesNotMatch(JSON.stringify(result), /whx_bundle/)
})

test('resource diagnosis rejects input controls and bounds the main-process structured result', () => {
  const f = fixture(expected)
  f.card.closest = () => ({})
  assert.equal(describeOwnedResourceShape(f.document, f.nodes, f.markers, expected).cards, 0)
  const result = normalizeOwnedResourceShape({ controls: Array(30).fill({ tag: 'button', text: 'secret', href: 'https://provider/', expected: true }), markerAncestors: Array(10).fill({ depth: 9, text: 'secret' }), prose: 'secret' })
  assert.equal(result.controls.length, 16)
  assert.equal(result.markerAncestors.length, 6)
  assert.equal(result.markerAncestors[0].depth, 6)
  assert.doesNotMatch(JSON.stringify(result), /secret|https:/)
})

test('compound response names retain chat identity and match only the final request suffix', () => {
  const f = fixture('whx_bundle_res_owned_req_older.zip')
  const compound = 'whx_bundle_res_owned_req_older_req_current.zip'
  const older = describeOwnedResourceShape(f.document, f.nodes, f.markers, compound)
  assert.equal(older.sameChat, 1)
  assert.equal(older.sameRequest, 0)
  const latest = fixture('whx_bundle_res_owned_req_current.zip')
  const current = describeOwnedResourceShape(latest.document, latest.nodes, latest.markers, compound)
  assert.equal(current.sameChat, 1)
  assert.equal(current.sameRequest, 1)
  assert.equal(current.expected, 0)
})
