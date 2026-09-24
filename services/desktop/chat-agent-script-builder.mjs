const json = (value) => JSON.stringify(value)

// Shared helpers injected into every behavior-driven DOM script. Keeping this
// runtime in one module lets focused script families stay below the repository
// size limit without changing the expressions injected into ChatGPT.
const PRELUDE = `
  const S = __whx.selectors, L = __whx.labels;
  const vis = (n) => { const r = n?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
  const usable = (n) => {
    if (!n || n.disabled || n.getAttribute?.('aria-disabled') === 'true' || n.hidden || n.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
    const s = globalThis.getComputedStyle?.(n);
    return s?.display !== 'none' && s?.visibility !== 'hidden' && s?.visibility !== 'collapse';
  };
  const pick = (list) => { for (const sel of list) { for (const n of document.querySelectorAll(sel)) if (usable(n) && vis(n)) return n } return null };
  const all = (list) => { const out = []; for (const sel of list) for (const n of document.querySelectorAll(sel)) if (vis(n) && !out.includes(n)) out.push(n); return out };
  const measure = (n) => { const r = n.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return (x < 0 || y < 0 || x > innerWidth || y > innerHeight) ? null : { x, y, width: Math.round(r.width), height: Math.round(r.height) }; };
  const rect = (n) => {
    const first = measure(n);
    if (first) return first;
    try { n.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) } catch { try { n.scrollIntoView(true) } catch { return null } }
    return measure(n);
  };
  const viewport = () => ({ w: innerWidth, h: innerHeight });
  const text = (n) => String(n?.getAttribute?.('aria-label') || n?.getAttribute?.('title') || n?.textContent || '').replace(/\\s+/g, ' ').trim();
  const fold = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
`

export { json }

export function script(behavior, body) {
  const context = json({
    selectors: behavior.selectors,
    optionalSelectors: behavior.optionalSelectors,
    labels: behavior.labels,
    effortLevels: behavior.effortLevels,
  })
  return `(() => { const __whx = ${context};${PRELUDE}\n${body}\n})()`
}
