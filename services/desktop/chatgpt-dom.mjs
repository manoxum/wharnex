function encode(value) {
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

function composerLookupSource() {
  return `
    const chooseUsable = ${chooseUsableChatGPTDOMCandidate.toString()};
    const composerSelectors = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'];
    const composer = chooseUsable(composerSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]));`
}

export function chatGPTFocusComposerScript() {
  return `(() => {
    ${composerLookupSource()}
    if (!composer) return false;
    composer.focus();
    return document.activeElement === composer;
  })()`
}

export function chatGPTFillComposerScript(text) {
  const value = encode(text)
  return `(() => {
    const value = ${value};
    ${composerLookupSource()}
    if (!composer) return false;
    composer.focus();
    if (document.activeElement !== composer) return false;
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const proto = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(composer, value); else composer.value = value;
    } else {
      composer.textContent = value;
      const range = document.createRange();
      range.selectNodeContents(composer); range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges(); selection?.addRange(range);
    }
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`
}

export function chatGPTSubmitScript() {
  return `(() => {
    ${composerLookupSource()}
    if (!composer) return false;
    const root = composer?.closest('form') || composer?.parentElement?.parentElement || document;
    const selectors = ['button[data-testid="send-button"]','button[type="submit"]'];
    const localButtons = selectors.flatMap((selector) => [...(root.querySelectorAll?.(selector) || [])]);
    const button = chooseUsable(localButtons) || chooseUsable(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]));
    if (!button) return false;
    button.click();
    return true;
  })()`
}


export function chatGPTAssistantTurnCountScript() {
  return `(() => document.querySelectorAll('[data-message-author-role="assistant"]').length)()`
}

export function chooseChatGPTDownloadCandidate(candidates, expectedFilename) {
  const expected = String(expectedFilename || '').trim().toLowerCase()
  if (!expected || !Array.isArray(candidates)) return { index: -1, mode: '' }
  const usable = candidates.filter((candidate) => candidate && candidate.visible !== false && candidate.disabled !== true)
  const exact = usable.find((candidate) => String(candidate.metadata || '').toLowerCase().includes(expected))
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
  return { index: -1, mode: '' }
}

export function chatGPTExpectedDownloadScript(filename, assistantBaseline = 0) {
  const expected = encode(filename)
  const baseline = Math.max(0, Number(assistantBaseline) || 0)
  const choose = chooseChatGPTDownloadCandidate.toString()
  return `(() => {
    const expected = ${expected};
    const baseline = ${baseline};
    const choose = ${choose};
    const assistantTurns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const latestAssistant = assistantTurns.length > baseline ? assistantTurns[assistantTurns.length - 1] : null;
    const nodes = [...document.querySelectorAll('a[download], a[href], button, [role="button"], [data-testid*="download"]')];
    const visible = (node) => {
      const rects = typeof node.getClientRects === 'function' ? node.getClientRects() : [];
      return Boolean(node.offsetWidth || node.offsetHeight || rects?.length);
    };
    const candidates = nodes.map((node, index) => {
      const href = String(node.getAttribute?.('href') || '');
      const ownText = String(node.textContent || '').trim();
      const card = node.closest?.('[data-testid*="file"], [data-testid*="attachment"], [class*="file"], [class*="attachment"]');
      const nearbyText = card && latestAssistant?.contains(card) ? String(card.textContent || '').trim().slice(0, 1200) : '';
      const metadata = [node.getAttribute?.('download'), node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.getAttribute?.('data-testid'), href, ownText, nearbyText].filter(Boolean).join(' ');
      const normalized = metadata.toLowerCase();
      return {
        index,
        metadata,
        visible: visible(node),
        disabled: Boolean(node.disabled || node.getAttribute?.('aria-disabled') === 'true'),
        latestAssistant: Boolean(latestAssistant && latestAssistant.contains(node)),
        nested: nodes.some((other, otherIndex) => otherIndex !== index && node.contains?.(other)),
        downloadSemantic: /(download|baixar|descarregar)/i.test(normalized),
        fileLike: Boolean(node.hasAttribute?.('download') || /(^|[\\/])(download|downloads|file|files|attachment|attachments)([\\/?#]|$)/i.test(href) || /^sandbox:/i.test(href)),
        iconOnly: /^(?:⬇️?|📥|⤓|↓)$/u.test(ownText),
      };
    });
    const decision = choose(candidates, expected);
    if (!Number.isInteger(decision.index) || decision.index < 0 || !nodes[decision.index]) return '';
    nodes[decision.index].click();
    return decision.mode || 'exact';
  })()`
}

export function chatGPTComposerReadyScript() {
  return `(() => {
    ${composerLookupSource()}
    return Boolean(composer);
  })()`
}

export function chatGPTHumanActionScript() {
  return `(() => {
    try {
    const path = String(location.pathname || '');
    const href = String(location.href || '');
    const title = String(document.title || '').trim().toLowerCase();
    const visible = (node) => { const rect = node?.getBoundingClientRect?.(); return Boolean(rect && rect.width > 0 && rect.height > 0); };
    const firstVisible = (selector) => [...document.querySelectorAll(selector)].find(visible);
    const challenge = Boolean(
      firstVisible('iframe[src*="challenges.cloudflare.com"],iframe[src*="/cdn-cgi/challenge-platform/"],iframe[src*="captcha" i],iframe[src*="arkoselabs" i],iframe[src*="funcaptcha" i],iframe[src*="hcaptcha.com" i],iframe[src*="recaptcha" i],input[name="cf-turnstile-response"],.cf-turnstile,.h-captcha,.g-recaptcha,#arkose,[data-testid*="captcha" i],[data-testid*="challenge" i]')
      || /\\/cdn-cgi\\/challenge-platform\\//i.test(href)
      || title === 'just a moment...'
      || title === 'security verification'
      || title === 'verify you are human'
      || title.startsWith('attention required')
    );
    const authentication = /^\\/auth(?:\\/|$)/i.test(path);
    const access = Boolean(firstVisible('[data-testid*="access-denied" i],[data-testid*="blocked" i],[data-testid*="unsupported-browser" i]'));
    ${composerLookupSource()}
    const kind = challenge ? 'verification' : authentication ? 'authentication' : access ? 'access' : '';
    return {
      required: Boolean(kind),
      kind,
      composerReady: Boolean(composer),
      pageVisible: document.visibilityState !== 'hidden',
      capturedAt: new Date().toISOString(),
    };
    } catch (_error) {
      return { required: false, kind: '', composerReady: false, pageVisible: false, capturedAt: new Date().toISOString() };
    }
  })()`
}

export function chatGPTResponseCompletionScript(assistantBaseline = 0) {
  const baseline = Math.max(0, Number(assistantBaseline) || 0)
  return `(() => {
    const baseline = ${baseline};
    const assistantCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
    // The stop-button testid is the primary "still generating/reasoning"
    // signal, but a renamed/restructured control must never read as "idle" —
    // that misreading is what makes the automatic recovery reload above
    // interrupt a genuinely still-running response. ".result-streaming" is
    // ChatGPT's own longstanding marker on the assistant message while its
    // text/reasoning is still being produced, independent of the button's
    // current testid/label.
    const stop = document.querySelector('button[data-testid="stop-button"], button[data-testid*="stop-button" i], button[aria-label*="stop generating" i], button[aria-label*="parar de gerar" i]')
      || document.querySelector('.result-streaming, [class*="result-streaming" i]');
    const failed = document.querySelector('[data-testid="conversation-turn-error"] button,button[data-testid="retry-button"],[data-testid="message-error"] button');
    ${composerLookupSource()}
    const composerReady = Boolean(composer);
    return { assistantCount, thinking: Boolean(stop), failed: Boolean(failed), composerReady, complete: Boolean(assistantCount > baseline && !stop && !failed && composerReady) };
  })()`
}

export function chatGPTVisibleActivityScript() {
  return `(() => {
    const stop = document.querySelector('button[data-testid="stop-button"], button[data-testid*="stop-button" i]')
      || document.querySelector('.result-streaming, [class*="result-streaming" i]');
    return { state: stop ? 'thinking' : 'idle', text: '', capturedAt: new Date().toISOString() };
  })()`
}
