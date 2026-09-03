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

export function chatGPTExpectedDownloadScript(filename) {
  const expected = encode(filename)
  return `(() => {
    const expected = ${expected}.toLowerCase();
    const nodes = [...document.querySelectorAll('a[download], a[href], button')];
    const text = (node) => [node.getAttribute?.('download'), node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.textContent].filter(Boolean).join(' ').toLowerCase();
    let target = nodes.find((node) => text(node).includes(expected));
    if (!target) {
      target = nodes.find((node) => {
        const own = text(node);
        if (!/(download|baixar|descarregar)/i.test(own)) return false;
        let parent = node.parentElement;
        for (let i = 0; i < 4 && parent; i += 1, parent = parent.parentElement) {
          if ((parent.textContent || '').toLowerCase().includes(expected)) return true;
        }
        return false;
      });
    }
    if (!target) return false;
    target.click();
    return true;
  })()`
}
