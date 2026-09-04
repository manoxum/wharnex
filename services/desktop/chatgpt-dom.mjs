function encode(value) {
  return JSON.stringify(String(value ?? ''))
}

export function chatGPTFocusComposerScript() {
  return `(() => {
    const selectors = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'];
    const el = selectors.map((s) => document.querySelector(s)).find(Boolean);
    if (!el) return false;
    el.focus();
    return true;
  })()`
}

export function chatGPTFillComposerScript(text) {
  const value = encode(text)
  return `(() => {
    const value = ${value};
    const selectors = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'];
    const el = selectors.map((s) => document.querySelector(s)).find(Boolean);
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
    } else {
      el.textContent = value;
      const range = document.createRange();
      range.selectNodeContents(el); range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges(); selection?.addRange(range);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`
}

export function chatGPTSubmitScript() {
  return `(() => {
    const composer = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'].map((s) => document.querySelector(s)).find(Boolean);
    const root = composer?.closest('form') || composer?.parentElement?.parentElement || document;
    const selectors = ['button[data-testid="send-button"]','button[aria-label*="Send"]','button[aria-label*="Enviar"]','button[type="submit"]'];
    const button = selectors.map((s) => root.querySelector?.(s) || document.querySelector(s)).find((candidate) => candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
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
    const nodes = [...document.querySelectorAll('a[download], a[href], button')];
    const visible = (node) => {
      const rects = typeof node.getClientRects === 'function' ? node.getClientRects() : [];
      return Boolean(node.offsetWidth || node.offsetHeight || rects?.length);
    };
    const candidates = nodes.map((node, index) => {
      const href = String(node.getAttribute?.('href') || '');
      const ownText = String(node.textContent || '').trim();
      const metadata = [node.getAttribute?.('download'), node.getAttribute?.('aria-label'), node.getAttribute?.('title'), href, ownText].filter(Boolean).join(' ');
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
    const stop = document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="Parar"]');
    if (stop) return false;
    const composer = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'].map((s) => document.querySelector(s)).find(Boolean);
    if (!composer) return false;
    const root = composer.closest?.('form') || document;
    const button = ['button[data-testid="send-button"]','button[aria-label*="Send"]','button[aria-label*="Enviar"]','button[type="submit"]'].map((s) => root.querySelector?.(s) || document.querySelector(s)).find(Boolean);
    return Boolean(button && !button.disabled && button.getAttribute?.('aria-disabled') !== 'true');
  })()`
}

export function chatGPTVisibleActivityScript() {
  return `(() => {
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
    const stop = document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="Parar"]');
    const candidates = [...document.querySelectorAll('[data-testid*="reason"],[data-testid*="think"],details,[aria-label*="thinking" i],[aria-label*="reason" i],[aria-label*="racioc" i]')]
      .filter(visible)
      .map((node) => String(node.innerText || node.textContent || node.getAttribute?.('aria-label') || '').trim())
      .filter((text) => text && text.length < 5000 && /(think|reason|racioc|pens|analis|consider)/i.test(text));
    const text = candidates[candidates.length - 1] || '';
    return { state: stop ? 'thinking' : 'idle', text: text.slice(0, 4000), capturedAt: new Date().toISOString() };
  })()`
}
