import { normalizeOwnedResourceShape } from './resource-shape.mjs'

const STATES = ['ready', 'exact-only-blocked', 'no-candidates', 'no-actionable-control', 'selection-ambiguous', 'skip']
const MODES = ['exact', 'latest-assistant-unique', 'latest-turn-unique', '']

// Executed inside the same scan. Never return its metadata/text/href strings.
export function describeDownloadCandidates(candidates, nodes, expected, decision, counts, exactOnly) {
  const usable = candidates.filter((row) => row.visible !== false && row.disabled !== true)
  const exact = (row) => String(row.metadata || '').toLowerCase().includes(String(expected || '').toLowerCase())
  const actionable = (row) => !row.nested && (row.downloadSemantic || row.fileLike || row.iconOnly)
  const selected = Number.isInteger(decision.index) && decision.index >= 0 && Boolean(nodes[decision.index])
  const blocked = selected && exactOnly && decision.mode !== 'exact'
  const ranked = [...usable.filter(exact), ...usable.filter((row) => !exact(row) && (row.latestAssistant || row.latestTurn))]
  const controls = ranked.slice(0, 16).map((row) => {
    const node = nodes[row.index]
    return { index: row.index, tag: String(node?.tagName || '').toLowerCase().slice(0, 20), role: String(node?.getAttribute?.('role') || '').slice(0, 32), testid: String(node?.getAttribute?.('data-testid') || '').slice(0, 64), exact: exact(row), disabled: row.disabled === true, nested: row.nested === true, fileLike: row.fileLike === true, downloadSemantic: row.downloadSemantic === true, latestAssistant: row.latestAssistant === true, latestTurn: row.latestTurn === true }
  })
  const state = blocked ? 'exact-only-blocked' : selected ? 'ready' : !usable.length ? 'no-candidates' : usable.filter(actionable).length > 1 ? 'selection-ambiguous' : 'no-actionable-control'
  return { state, mode: decision.mode || '', exactOnly: exactOnly === true, scanned: candidates.length, usable: usable.length, exact: usable.filter(exact).length, latest: usable.filter((row) => row.latestAssistant || row.latestTurn).length, actionable: usable.filter(actionable).length, assistants: counts.assistants, markers: counts.markers, baseline: counts.baseline, controls }
}

export function normalizeDownloadDiagnostic(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const result = { state: STATES.includes(source.state) ? source.state : 'skip', mode: MODES.includes(source.mode) ? source.mode : '', exactOnly: source.exactOnly === true }
  for (const field of ['scanned', 'usable', 'exact', 'latest', 'actionable', 'assistants', 'markers', 'baseline']) result[field] = Math.max(0, Math.min(1_000_000, Number.isFinite(source[field]) ? Math.floor(source[field]) : 0))
  result.controls = Array.isArray(source.controls) ? source.controls.slice(0, 16).map((row) => {
    const control = { index: Math.max(0, Math.min(1_000_000, Number(row?.index) || 0)) }
    for (const key of ['tag', 'role', 'testid']) control[key] = typeof row?.[key] === 'string' ? row[key].slice(0, 64) : ''
    for (const key of ['exact', 'disabled', 'nested', 'fileLike', 'downloadSemantic', 'latestAssistant', 'latestTurn']) control[key] = row?.[key] === true
    return control
  }) : []
  result.resources = normalizeOwnedResourceShape(source.resources)
  return result
}
