export function chooseChatGPTDownloadCandidate(candidates, expectedFilename) {
  const expected = String(expectedFilename || '').trim().toLowerCase()
  if (!expected || !Array.isArray(candidates)) return { index: -1, mode: '' }
  const usable = candidates.filter((candidate) => candidate && candidate.visible !== false && candidate.disabled !== true)
  // Context increments and the final Orchestrator plan reuse one filename.
  // Prefer the most recent matching card, while still choosing its actionable
  // control over a surrounding resource-card wrapper.
  const exactMatches = usable.filter((candidate) => String(candidate.metadata || '').toLowerCase().includes(expected)).reverse()
  const exact = exactMatches.find((candidate) => !candidate.nested && (candidate.downloadSemantic || candidate.fileLike))
    || exactMatches.find((candidate) => !candidate.nested)
    || exactMatches[0]
  if (exact) return { index: Number(exact.index), mode: 'exact' }

  // ChatGPT occasionally renders a generated file as an icon-only link/button
  // without exposing the requested filename in visible/accessible text. In that
  // case fail closed unless the newest assistant turn contains exactly one
  // download/file affordance. The subsequent will-download + bundle validators
  // remain authoritative for the request id and ZIP contents.
  const fallback = usable.filter((candidate) => candidate.latestAssistant === true && candidate.nested !== true && (
    candidate.downloadSemantic === true || candidate.fileLike === true || candidate.iconOnly === true
  ))
  if (fallback.length === 1) return { index: Number(fallback[0].index), mode: 'latest-assistant-unique' }
  const latestTurnFallback = usable.filter((candidate) => candidate.latestTurn === true && candidate.nested !== true && (
    candidate.downloadSemantic === true || candidate.fileLike === true || candidate.iconOnly === true
  ))
  if (latestTurnFallback.length === 1) return { index: Number(latestTurnFallback[0].index), mode: 'latest-turn-unique' }
  return { index: -1, mode: '' }
}

