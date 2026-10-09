// Existing allowlisted candidate scan; shared by activation and passive diagnostics.
export const DOWNLOAD_CANDIDATE_SCAN = `
    const assistantTurns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const agentMarkers = [...document.querySelectorAll('[data-chatgpt-agent-turn-start]')];
    const latestAgentTurn = agentMarkers.length > baseline ? agentMarkers[agentMarkers.length - 1]?.parentElement : null;
    const latestAssistant = assistantTurns.length > baseline ? assistantTurns[assistantTurns.length - 1] : latestAgentTurn;
    const turns = [...document.querySelectorAll('[data-turn-id]')];
    const latestTurn = latestAssistant?.closest?.('[data-turn-id]') || (assistantTurns.length > baseline ? turns[turns.length - 1] : null);
    const nodes = [...document.querySelectorAll('a[download], a[href], button, [role="button"], [role="link"], [data-testid*="download"], [data-testid*="file"], [data-testid*="attachment"], [class~="group/resource-card"]')];
    let conversationMain;
    let conversationMainRead = false;
    let roleLinksInspected = 0;
    const visible = (node) => {
      const rects = typeof node.getClientRects === 'function' ? node.getClientRects() : [];
      return Boolean(node.offsetWidth || node.offsetHeight || rects?.length);
    };
    const candidates = nodes.map((node, index) => {
      const inputSelector = '[data-message-author-role="user"], [class~="group/user-message"], form[data-chatgpt-composer], [data-composer-surface]';
      if (node.closest?.(inputSelector)?.matches?.(inputSelector)) return { index, visible: false };
      if (node.getAttribute?.('role') === 'link') {
        if (!roleLinkNativeEnabled) return { index, visible: false };
        if (!conversationMainRead) {
          conversationMainRead = true;
          try { conversationMain = document.querySelector?.('main'); } catch { conversationMain = null; }
        }
        if (!conversationMain?.contains?.(node) || node.closest?.('nav, aside')) return { index, visible: false };
        if (roleLinksInspected++ >= 128) return { index, visible: false };
        const fresh = !requireFreshAssistant || Boolean(latestAssistant?.contains(node) || latestTurn?.contains(node));
        return inspectRoleLink(node, index, expected, conversationMain, nodes, fresh);
      }
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
`
