// Interactive elements of the page under test, each with a selector proven to
// match exactly one node, so the controller does not have to guess selectors
// from a screenshot. Runs in the tested application's page (never ChatGPT's);
// the result is bounded and travels as untrusted data inside the step bundle.

export const PAGE_ELEMENTS_SCRIPT = `(() => {
  const MAX = 200
  const css = (value) => (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/["\\\\]/g, '\\\\$&')
  const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1 } catch { return false } }
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const clip = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit)
  const selectorFor = (el) => {
    const tag = el.tagName.toLowerCase()
    const candidates = []
    if (el.id) candidates.push('#' + css(el.id))
    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(attr)
      if (value) candidates.push(tag + '[' + attr + '="' + css(value) + '"]')
    }
    if (el.getAttribute('type')) candidates.push(tag + '[type="' + css(el.getAttribute('type')) + '"]')
    for (const candidate of candidates) if (unique(candidate)) return candidate
    const path = []
    for (let node = el; node && node.nodeType === 1 && path.length < 6; node = node.parentElement) {
      const parent = node.parentElement
      const name = node.tagName.toLowerCase()
      if (node.id) { path.unshift('#' + css(node.id)); break }
      const index = parent ? [...parent.children].filter((child) => child.tagName === node.tagName).indexOf(node) + 1 : 1
      path.unshift(name + ':nth-of-type(' + index + ')')
      if (unique(path.join(' > '))) return path.join(' > ')
    }
    const joined = path.join(' > ')
    return unique(joined) ? joined : ''
  }
  const nodes = document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=true],label,summary')
  const out = []
  for (const el of nodes) {
    if (out.length >= MAX) break
    if (!visible(el) || (el.tagName === 'INPUT' && el.type === 'hidden')) continue
    const selector = selectorFor(el)
    if (!selector) continue
    out.push({
      selector, tag: el.tagName.toLowerCase(), type: clip(el.getAttribute('type'), 30), role: clip(el.getAttribute('role'), 40),
      label: clip(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('title'), 120),
      text: clip(el.innerText || el.value, 120), placeholder: clip(el.getAttribute('placeholder'), 120), disabled: Boolean(el.disabled),
    })
  }
  return out
})()`

export async function capturePageElements(wc) {
  try {
    const elements = await wc.executeJavaScript(PAGE_ELEMENTS_SCRIPT, true)
    return Array.isArray(elements) ? elements.slice(0, 200) : []
  } catch { return [] }
}
