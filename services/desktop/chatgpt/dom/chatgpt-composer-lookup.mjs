// Shared pieces of the page scripts: the usable-composer lookup every
// composer-aware script embeds, and safe string encoding into script source.

export function encode(value) {
  return JSON.stringify(String(value ?? ''))
}

export function chooseUsableChatGPTDOMCandidate(candidates, styleFor = (node) => globalThis.getComputedStyle?.(node)) {
  const seen = new Set()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    if (candidate.isConnected === false || candidate.disabled === true || candidate.getAttribute?.('aria-disabled') === 'true') continue
    if (candidate.hidden === true || candidate.closest?.('[hidden], [aria-hidden="true"], [inert]')) continue
    const style = styleFor?.(candidate)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') continue
    return candidate
  }
  return undefined
}

export function composerLookupSource() {
  return `
    const chooseUsable = ${chooseUsableChatGPTDOMCandidate.toString()};
    const composerSelectors = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'];
    const composer = chooseUsable(composerSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]));`
}
