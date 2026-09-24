const MAX_ROWS = 8
const MIN_CHARS = 8
const MAX_CHARS = 200

// This is a deliberately closed selector family. It identifies the provider's
// reasoning chrome, not a semantic guess based on generated text.
const REASONING_ROOTS = '[data-testid*="reasoning" i],[data-testid*="thinking" i],[data-testid*="analysis" i],[class~="group/activity-header"]'
const BANNED_CONTENT = ['pre', 'code', '.markdown', '.sr-only', '[data-markdown-copy]']
const LEGACY_BANNED_CONTENT = [...BANNED_CONTENT, '[data-message-author-role]']
const STOP_CONTROL = 'button[data-testid="stop-button"], button[data-testid*="stop-button" i], button:has(svg.icon-primary-action path[d^="M4.5 5.75"])'

export function chatGPTVisibleActivityScript() {
  return `(() => {
    const stop = document.querySelector('${STOP_CONTROL}')
      || document.querySelector('.result-streaming, [class*="result-streaming" i]');
    const state = stop ? 'thinking' : 'idle';
    let text = '';
    try {
      const visible = (node) => Boolean(node?.getClientRects?.().length);
      const roots = [...document.querySelectorAll('${REASONING_ROOTS}')].filter(visible);
      // A live agent turn now owns several sibling/nested activity headers.
      // Scope them through the provider's latest turn marker so older turns do
      // not leak into this request's decorative activity panel.
      const marker = [...document.querySelectorAll('[data-chatgpt-agent-turn-start]')].at(-1) || null;
      const scopedRoots = marker?.parentElement
        ? [...marker.parentElement.querySelectorAll('${REASONING_ROOTS}')].filter(visible)
        : roots.length ? [roots.at(-1)] : [];
      const panel = scopedRoots.length ? null : [...document.querySelectorAll('[data-turn-id]')].pop() || null;
      const containers = [];
      for (const root of scopedRoots) {
        containers.push({ node: root, detail: false });
        // Expanded activity details are the immediate sibling after a header.
        // Only provider-marked prose rows inside that body are admitted below;
        // tool/code/output regions therefore remain outside the exception.
        if (root.parentElement?.firstElementChild === root) {
          const body = root.nextElementSibling;
          if (body && visible(body)) containers.push({ node: body, detail: true });
        }
      }
      if (!containers.length && panel) containers.push({ node: panel, detail: false });
      const banned = scopedRoots.length ? ${JSON.stringify(BANNED_CONTENT)} : ${JSON.stringify(LEGACY_BANNED_CONTENT)};
      const rows = [];
      const seen = new Set();
      for (const container of containers) {
        const candidates = container.detail
          ? [...container.node.querySelectorAll('[data-markdown-text-style]')]
            .filter((node) => !node.querySelectorAll('[data-markdown-text-style]').length)
          : container.node.querySelectorAll('span, div, p, li');
        for (const node of candidates) {
          if (rows.length >= ${MAX_ROWS}) break;
          if ((!container.detail && node.children.length) || node.closest('button,[role="button"]')) continue;
          if (banned.some((selector) => node.closest(selector) || node.querySelectorAll(selector).length)) continue;
          const value = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
          if (value.length < ${MIN_CHARS} || value.length > ${MAX_CHARS}) continue;
          const key = value.toLocaleLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(value);
        }
      }
      // Containers sometimes report the concatenation of their child rows.
      const steps = rows.filter((row) => !rows.some((other) => other !== row && row.includes(other)));
      text = steps.map((row) => '- ' + row).join('\\n');
    } catch { /* reasoning is optional; liveness is not */ }
    return { state, text, capturedAt: new Date().toISOString() };
  })()`
}
