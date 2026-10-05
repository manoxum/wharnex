const CONTENT_ROOTS = ['context/', 'ref-context/', 'att-context/']
const SOURCE_INDEX = 'metadata/context-sources.json'

// The session owns which context mode applies and which captured files the
// planner has asked for. A Full session (including every session from before
// the mode existed) sends the whole snapshot. A Partial session sends the
// maps plus the cumulative selection of its current Main Request lineage; a
// request that is not the session's latest (a knowledge review, a resend)
// still receives that selection, because withholding the send over it would
// block the chat while the planner can always ask for more.
export function contextSelectionFromSession(state) {
  if (state?.context_mode !== 'partial') return { mode: 'full', paths: [] }
  return { mode: 'partial', paths: Array.isArray(state.context_paths) ? state.context_paths.map(String) : [] }
}

// Path count is not a protocol limit (adr/ADR-0083): the backend bounds the
// selection by bytes, and every Partial Main Request already starts from the
// project's normative documents.
export function selectArchiveContextEntries(entries, context) {
  if (context?.mode !== 'partial') return entries
  const paths = Array.isArray(context?.paths) ? context.paths : []
  if (new Set(paths).size !== paths.length) throw new Error('Invalid selected context paths')
  const available = new Map(entries.map((entry) => [entry.name, entry]))
  const selected = new Set()
  for (const name of paths) {
    if (typeof name !== 'string' || !CONTENT_ROOTS.some((root) => name.startsWith(root)) || !available.has(name)) {
      throw new Error(`Selected context path is absent from the captured snapshot: ${String(name)}`)
    }
    selected.add(name)
  }
  if (available.has(SOURCE_INDEX)) selected.add(SOURCE_INDEX)
  return entries.filter((entry) => selected.has(entry.name))
}
