const MAX_ROWS = 8
const MIN_CHARS = 8
const MAX_CHARS = 200

// This is a deliberately closed selector family. It identifies the provider's
// reasoning chrome, not a semantic guess based on generated text.
const REASONING_ROOTS = '[data-testid*="reasoning" i],[data-testid*="thinking" i],[data-testid*="analysis" i],[class~="group/activity-header"]'
const BANNED_CONTENT = ['pre', 'code', '.markdown', '.sr-only']
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
      // A reasoning root is an explicit provider-owned boundary. It remains
      // valid even when the new DOM nests it inside an assistant turn; the
      // legacy fallback must still exclude those turns to avoid answer prose.
      const panel = roots.length ? null : [...document.querySelectorAll('[data-turn-id]')].pop() || null;
      const containers = roots.length ? [roots.at(-1)] : panel ? [panel] : [];
      const banned = roots.length ? ${JSON.stringify(BANNED_CONTENT)} : ${JSON.stringify(LEGACY_BANNED_CONTENT)};
      const rows = [];
      const seen = new Set();
      for (const container of containers) {
        for (const node of container.querySelectorAll('span, div, p, li')) {
          if (rows.length >= ${MAX_ROWS}) break;
          if (node.children.length || node.closest('button,[role="button"]')) continue;
          if (banned.some((selector) => node.closest(selector))) continue;
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
