function encode(value) {
  return JSON.stringify(String(value ?? ''))
}

// Shared prelude for every account script. `visible` rejects nodes that occupy
// no layout box; `rect` returns the viewport-relative centre a trusted native
// click must target, because ChatGPT's menu items are Radix `div[role=menuitem]`
// nodes that ignore synthetic HTMLElement.click() entirely.
const PRELUDE = `
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
    const usable = (node) => {
      if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.hidden || node.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
      const style = globalThis.getComputedStyle?.(node);
      return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
    };
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
      return { x, y, width: Math.round(r.width), height: Math.round(r.height) };
    };
    const viewport = () => ({ w: innerWidth, h: innerHeight });
    const label = (node) => String(node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || node?.textContent || '').replace(/\\s+/g, ' ').trim();
`

// Wraps one account script body in the shared prelude, as an immediately
// evaluated expression for executeJavaScript.
export function accountScript(body) {
  return `(() => {${PRELUDE}${body}})()`
}

export { encode }
