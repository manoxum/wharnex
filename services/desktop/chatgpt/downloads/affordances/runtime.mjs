import { chooseChatGPTDownloadCandidate } from './decision.mjs'
import { DOWNLOAD_CANDIDATE_SCAN } from './scan.mjs'
import { describeDownloadCandidates } from './diagnostic.mjs'
import { describeOwnedResourceShape } from './resource-shape.mjs'

function build(filename, assistantBaseline, freshOnly, exactOnly, { diagnostics = false, passive = false } = {}) {
  const baseline = Math.max(0, Number(assistantBaseline) || 0)
  const prelude = `const expected = ${JSON.stringify(String(filename || ''))};
    const baseline = ${baseline}; const requireFreshAssistant = ${freshOnly === true};
    const choose = ${chooseChatGPTDownloadCandidate.toString()};
    ${DOWNLOAD_CANDIDATE_SCAN}
    const decision = choose(candidates, expected);`
  const diagnostic = diagnostics || passive ? `
    const describe = ${describeDownloadCandidates.toString()};
    const diagnostic = describe(candidates,nodes,expected,decision,{assistants:assistantTurns.length,markers:agentMarkers.length,baseline},${exactOnly === true});
    const describeResources = ${describeOwnedResourceShape.toString()};
    try { diagnostic.resources = describeResources(document,nodes,agentMarkers,expected); }
    catch { diagnostic.resources = { unavailable:true }; }` : ''
  if (passive) return `(() => { ${prelude}${diagnostic} return diagnostic; })()`
  if (diagnostics) return `(() => { ${prelude}${diagnostic}
    if (!Number.isInteger(decision.index) || decision.index < 0 || !nodes[decision.index]) return { mode:'',diagnostic };
    if (${exactOnly === true} && decision.mode !== 'exact') return { mode:'',diagnostic };
    nodes[decision.index].click(); return { mode:decision.mode || 'exact',diagnostic };
  })()`
  // Preserve the shipped string-returning interface for Workers and utilities.
  return `(() => { ${prelude}
    if (!Number.isInteger(decision.index) || decision.index < 0 || !nodes[decision.index]) return '';
    if (${exactOnly === true} && decision.mode !== 'exact') return '';
    nodes[decision.index].click(); return decision.mode || 'exact';
  })()`
}

export function chatGPTExpectedDownloadScript(filename, assistantBaseline = 0, freshOnly = false, exactOnly = false, options = {}) {
  return build(filename, assistantBaseline, freshOnly, exactOnly, { diagnostics: options?.diagnostics === true })
}
export function chatGPTExpectedDownloadDiagnosticScript(filename, assistantBaseline = 0, freshOnly = false, exactOnly = false) {
  return build(filename, assistantBaseline, freshOnly, exactOnly, { passive: true })
}
