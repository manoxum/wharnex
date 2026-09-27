import { RATE_LIMIT_GATE_SELECTORS } from './chatgpt-rate-limit.mjs'
export { chatGPTVisibleActivityScript } from './chatgpt-visible-activity.mjs'

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

export function chatGPTFillComposerScript(text) {
  const value = encode(text)
  return `(() => {
    const value = ${value};
    ${composerLookupSource()}
    if (!composer) return false;
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const proto = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(composer, value); else composer.value = value;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    // ChatGPT's composer is a rich editor holding its own document model, not
    // a plain contenteditable. Assigning textContent wrote around that model
    // and cost this transport both of its symptoms: the editor re-rendered
    // from its own (still empty) state when the attachment landed, so the
    // request arrived as a bare ZIP with no prompt at all, and what did
    // survive arrived as one run-on line because textContent carries no block
    // structure - every "\\n" collapsed to a space.
    //
    // Deliberately NOT offered as a paste. ChatGPT turns a long pasted text
    // into an attachment of its own, so the composer then had a spurious
    // pasted-text file to process before it could even start uploading the
    // request ZIP - live-reported as the bundle upload, previously immediate,
    // taking a long time to begin. One paragraph per line writes the same text
    // with the block structure textContent cannot carry, and nothing else
    // about the previous, working behaviour changes.
    composer.textContent = '';
    for (const line of String(value).split('\\n')) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      composer.appendChild(paragraph);
    }
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    // Reaching here is success, exactly as it has always been: a missing
    // composer is the one failure this script reports, and every caller
    // treats a false as fatal to the request. Verifying the write by reading
    // the composer back added a second way to fail that the working version
    // never had, and it fired on writes that had in fact landed - the editor
    // decides how its own content reads back, so no comparison here is
    // authoritative. This script's one job is to put the text in.
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

export function chatGPTSubmittedRequestEvidenceScript(filename) {
  const expected = encode(filename)
  return `(() => {
    const expected = ${expected}.trim().toLowerCase();
    const unique = (values) => [...new Set(values)];
    const turns = unique([
      ...document.querySelectorAll('[data-message-author-role="user"]'),
      ...document.querySelectorAll('[class~="group/user-message"]'),
    ]).slice(-40);
    let inspectedCards = 0;
    for (const turn of turns) {
      const cards = unique([
        ...turn.querySelectorAll('[class~="group/resource-card"]'),
        ...turn.querySelectorAll('[data-testid*="attachment" i], [data-testid*="file" i]'),
      ]).slice(-24);
      for (const card of cards) {
        inspectedCards += 1;
        const nodes = [card, ...card.querySelectorAll('span,button,a,[role="button"]')].slice(0, 120);
        const exact = nodes.some((node) => {
          const values = [
            node.children?.length ? '' : node.textContent,
            node.getAttribute?.('aria-label'),
            node.getAttribute?.('title'),
            node.getAttribute?.('download'),
          ];
          return values.some((value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase() === expected);
        });
        if (exact) return { submitted: true, userTurn: true, attachment: true, inspectedTurns: turns.length, inspectedCards };
      }
    }
    return { submitted: false, userTurn: turns.length > 0, attachment: false, inspectedTurns: turns.length, inspectedCards };
  })()`
}

export { chooseChatGPTDownloadCandidate, chatGPTExpectedDownloadScript } from './chatgpt-download-dom.mjs'

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
    // ChatGPT's own "too many requests" affordance. Structural selectors only,
    // so this reads the same in every interface language. It is deliberately
    // NOT a human-action kind: the account reopens on its own, so the answer is
    // a durable provider suspension, not a notification asking for a person.
    const rateLimited = Boolean(firstVisible(${encode(RATE_LIMIT_GATE_SELECTORS.join(','))}));
    ${composerLookupSource()}
    const kind = challenge ? 'verification' : authentication ? 'authentication' : access ? 'access' : '';
    return {
      required: Boolean(kind),
      kind,
      rateLimited,
      composerReady: Boolean(composer),
      pageVisible: document.visibilityState !== 'hidden',
      capturedAt: new Date().toISOString(),
    };
    } catch (_error) {
      return { required: false, kind: '', rateLimited: false, composerReady: false, pageVisible: false, capturedAt: new Date().toISOString() };
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
    const stop = document.querySelector('button[data-testid="stop-button"], button[data-testid*="stop-button" i], button:has(svg.icon-primary-action path[d^="M4.5 5.75"])')
      || document.querySelector('.result-streaming, [class*="result-streaming" i]');
    const failed = document.querySelector('[data-testid="conversation-turn-error"] button,button[data-testid="retry-button"],[data-testid="message-error"] button');
    ${composerLookupSource()}
    const composerReady = Boolean(composer);
    return { assistantCount, thinking: Boolean(stop), failed: Boolean(failed), composerReady, complete: Boolean(assistantCount > baseline && !stop && !failed && composerReady) };
  })()`
}

export function parseChatGPTProcessingDuration(value, prefixes = []) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  const allowed = (Array.isArray(prefixes) ? prefixes : []).map((entry) => String(entry || '').trim().toLocaleLowerCase()).filter(Boolean)
  const prefix = allowed.find((entry) => text.startsWith(entry))
  if (!prefix) return 0
  const duration = text.slice(prefix.length).trim()
  if (!duration || duration.length > 80) return 0
  let totalSeconds = 0
  let matches = 0
  const pattern = /(\d{1,4})\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/gi
  for (const match of duration.matchAll(pattern)) {
    const amount = Number(match[1])
    const unit = String(match[2]).toLowerCase()
    if (!Number.isFinite(amount)) return 0
    if (unit.startsWith('h')) totalSeconds += amount * 3600
    else if (unit.startsWith('m')) totalSeconds += amount * 60
    else totalSeconds += amount
    matches += 1
  }
  if (!matches || totalSeconds <= 0 || totalSeconds > 24 * 60 * 60) return 0
  return totalSeconds * 1000
}

export function chatGPTProcessingDurationScript(prefixes = [], assistantBaseline = 0) {
  const labels = JSON.stringify((Array.isArray(prefixes) ? prefixes : []).map((entry) => String(entry || '').trim()).filter(Boolean))
  const baseline = Math.max(0, Number(assistantBaseline) || 0)
  const parser = parseChatGPTProcessingDuration.toString()
  return `(() => {
    const prefixes = ${labels};
    const baseline = ${baseline};
    const parseDuration = ${parser};
    const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (turns.length <= baseline) return { durationMs: 0, matched: false };
    const latest = turns[turns.length - 1];
    const disclosures = [...latest.querySelectorAll('button[aria-expanded]')].filter((node) => {
      const text = String(node.textContent || node.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
      return prefixes.some((prefix) => text.startsWith(String(prefix).toLocaleLowerCase()));
    });
    if (disclosures.length !== 1) return { durationMs: 0, matched: false };
    const label = String(disclosures[0].textContent || disclosures[0].getAttribute('aria-label') || '');
    const durationMs = parseDuration(label, prefixes);
    return { durationMs, matched: durationMs > 0 };
  })()`
}
