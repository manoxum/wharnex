// Control names are structural compatibility metadata, never a model catalog.
const SELECTORS = Object.freeze([
  'button[data-testid="model-switcher-dropdown-button"]',
  'button[data-testid="model-switcher"]',
  '[data-composer-surface] button[aria-haspopup="menu"]:not([data-testid])',
  'form[data-chatgpt-composer] button[aria-haspopup="menu"]:not([data-testid])',
])
const LABELS = Object.freeze(['selecionar modelo do chatgpt', 'select chatgpt model', 'select model', 'choose model'])

export function modelControlLookupSource() {
  return `
    const modelSelectors = ${JSON.stringify(SELECTORS)};
    const modelControlLabels = ${JSON.stringify(LABELS)};
    const modelControlMatches = (selector,node) => selector.includes('data-testid="') || modelControlLabels.includes(String(node.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim().toLowerCase());
  `
}
