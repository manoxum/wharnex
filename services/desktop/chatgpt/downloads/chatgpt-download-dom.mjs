function encode(value) {
  return JSON.stringify(String(value ?? ''))
}

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

// exactOnly accepts only a control naming the exact file: used when the whole
// conversation is searched, where an unnamed "only file in the last answer"
// could belong to another request.
export function chatGPTExpectedDownloadScript(filename, assistantBaseline = 0, freshOnly = false, exactOnly = false) {
  const expected = encode(filename)
  const requireExact = exactOnly === true
  const baseline = Math.max(0, Number(assistantBaseline) || 0)
  const requireFreshAssistant = freshOnly === true
  const choose = chooseChatGPTDownloadCandidate.toString()
  return `(() => {
    const expected = ${expected};
    const baseline = ${baseline};
    const requireFreshAssistant = ${requireFreshAssistant};
    const choose = ${choose};
    const assistantTurns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const agentMarkers = [...document.querySelectorAll('[data-chatgpt-agent-turn-start]')];
    const latestAgentTurn = agentMarkers.length > baseline ? agentMarkers[agentMarkers.length - 1]?.parentElement : null;
    const latestAssistant = assistantTurns.length > baseline ? assistantTurns[assistantTurns.length - 1] : latestAgentTurn;
    const turns = [...document.querySelectorAll('[data-turn-id]')];
    const latestTurn = latestAssistant?.closest?.('[data-turn-id]') || (assistantTurns.length > baseline ? turns[turns.length - 1] : null);
    const nodes = [...document.querySelectorAll('a[download], a[href], button, [role="button"], [data-testid*="download"], [data-testid*="file"], [data-testid*="attachment"], [class~="group/resource-card"]')];
    const visible = (node) => {
      const rects = typeof node.getClientRects === 'function' ? node.getClientRects() : [];
      return Boolean(node.offsetWidth || node.offsetHeight || rects?.length);
    };
    const candidates = nodes.map((node, index) => {
      const inputSelector = '[data-message-author-role="user"], [class~="group/user-message"], form[data-chatgpt-composer], [data-composer-surface]';
      if (node.closest?.(inputSelector)?.matches?.(inputSelector)) return { index, visible: false };
      const href = String(node.getAttribute?.('href') || '');
      const ownText = String(node.textContent || '').trim();
      const card = node.closest?.('[data-testid*="file"], [data-testid*="attachment"], [class*="file"], [class*="attachment"], [class~="group/resource-card"]');
      const nearbyText = card && (assistantTurns.some((turn) => turn.contains(card)) || latestAgentTurn?.contains(card)) ? String(card.textContent || '').trim().slice(0, 1200) : '';
      const metadata = [node.getAttribute?.('download'), node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.getAttribute?.('data-testid'), href, ownText, nearbyText].filter(Boolean).join(' ');
      const normalized = metadata.toLowerCase();
      return {
        index,
        metadata,
        visible: visible(node) && (!requireFreshAssistant || Boolean(latestAssistant?.contains(node) || latestTurn?.contains(node))),
        disabled: Boolean(node.disabled || node.getAttribute?.('aria-disabled') === 'true'),
        latestAssistant: Boolean(latestAssistant && latestAssistant.contains(node)),
        latestTurn: Boolean(latestTurn && latestTurn.contains(node)),
        nested: nodes.some((other, otherIndex) => otherIndex !== index && node.contains?.(other)),
        // European Portuguese ChatGPT accounts label the download control
        // "Transferir" (a Brazilian account uses "Baixar"), which this
        // pattern did not cover - the control existed and was visible but
        // never matched, so the result card sat there unclicked until the
        // task timed out.
        downloadSemantic: /(download|baixar|descarregar|transferir)/i.test(normalized),
        fileLike: Boolean(node.hasAttribute?.('download') || /(^|[\\/])(download|downloads|file|files|attachment|attachments)([\\/?#]|$)/i.test(href) || /^sandbox:/i.test(href)),
        iconOnly: /^(?:⬇️?|📥|⤓|↓)$/u.test(ownText),
      };
    });
    const decision = choose(candidates, expected);
    if (!Number.isInteger(decision.index) || decision.index < 0 || !nodes[decision.index]) return '';
    if (${requireExact} && decision.mode !== 'exact') return '';
    nodes[decision.index].click();
    return decision.mode || 'exact';
  })()`
}
