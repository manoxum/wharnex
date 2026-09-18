import { RATE_LIMIT_GATE_SELECTORS } from './chatgpt-rate-limit.mjs'

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
    } else {
      composer.textContent = value;
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
  const latestTurnFallback = usable.filter((candidate) => candidate.latestTurn === true && candidate.nested !== true && (
    candidate.downloadSemantic === true || candidate.fileLike === true || candidate.iconOnly === true
  ))
  if (latestTurnFallback.length === 1) return { index: Number(latestTurnFallback[0].index), mode: 'latest-turn-unique' }
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
    const turns = [...document.querySelectorAll('[data-turn-id]')];
    const latestTurn = latestAssistant?.closest?.('[data-turn-id]') || (assistantTurns.length > baseline ? turns[turns.length - 1] : null);
    const nodes = [...document.querySelectorAll('a[download], a[href], button, [role="button"], [data-testid*="download"], [data-testid*="file"], [data-testid*="attachment"]')];
    const visible = (node) => {
      const rects = typeof node.getClientRects === 'function' ? node.getClientRects() : [];
      return Boolean(node.offsetWidth || node.offsetHeight || rects?.length);
    };
    const candidates = nodes.map((node, index) => {
      const href = String(node.getAttribute?.('href') || '');
      const ownText = String(node.textContent || '').trim();
      const card = node.closest?.('[data-testid*="file"], [data-testid*="attachment"], [class*="file"], [class*="attachment"]');
      const nearbyText = card && (latestAssistant?.contains(card) || latestTurn?.contains(card)) ? String(card.textContent || '').trim().slice(0, 1200) : '';
      const metadata = [node.getAttribute?.('download'), node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.getAttribute?.('data-testid'), href, ownText, nearbyText].filter(Boolean).join(' ');
      const normalized = metadata.toLowerCase();
      return {
        index,
        metadata,
        visible: visible(node),
        disabled: Boolean(node.disabled || node.getAttribute?.('aria-disabled') === 'true'),
        latestAssistant: Boolean(latestAssistant && latestAssistant.contains(node)),
        latestTurn: Boolean(latestTurn && latestTurn.contains(node)),
        nested: nodes.some((other, otherIndex) => otherIndex !== index && node.contains?.(other)),
        // European Portuguese ChatGPT accounts label the download control
        // "Transferir" (a Brazilian account uses "Baixar"), which this
        // pattern did not cover - the control existed and was visible but
        // never matched, so the result card sat there unclicked until the
        // task timed out.
        downloadSemantic: /(download|baixar|descarregar|transferir)/i.test(normalized),
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
    const stop = document.querySelector('button[data-testid="stop-button"], button[data-testid*="stop-button" i], button[aria-label*="stop generating" i], button[aria-label*="parar de gerar" i]')
      || document.querySelector('.result-streaming, [class*="result-streaming" i]');
    const failed = document.querySelector('[data-testid="conversation-turn-error"] button,button[data-testid="retry-button"],[data-testid="message-error"] button');
    ${composerLookupSource()}
    const composerReady = Boolean(composer);
    return { assistantCount, thinking: Boolean(stop), failed: Boolean(failed), composerReady, complete: Boolean(assistantCount > baseline && !stop && !failed && composerReady) };
  })()`
}

// Reasoning-row extraction bounds. Deliberately small: this runs on every
// health-probe tick for every supervised chat.
const VISIBLE_REASONING_MAX_ROWS = 8
const VISIBLE_REASONING_MIN_CHARS = 8
const VISIBLE_REASONING_MAX_CHARS = 200

/**
 * Structural liveness plus the reasoning steps ChatGPT is currently showing.
 *
 * While the model works, its steps stream directly into the newest turn
 * ("Validou estilos e temas da interface"); once it finishes they collapse
 * behind a disclosure. Only the live form is read here, because this is a
 * passive probe — expanding a disclosure would be a mutation, and a probe must
 * never click.
 *
 * "Useful" is decided structurally, never by reading what a row says: a row is
 * a short leaf line that neither sits inside nor contains a code or markdown
 * region, and is not screen-reader-only chrome. That is what separates a
 * reasoning step from the tool/code block beside it and from the answer itself.
 */
export function chatGPTVisibleActivityScript() {
  return `(() => {
    const stop = document.querySelector('button[data-testid="stop-button"], button[data-testid*="stop-button" i]')
      || document.querySelector('.result-streaming, [class*="result-streaming" i]');
    const state = stop ? 'thinking' : 'idle';

    let text = '';
    try {
      // Anchored on the newest conversation turn, not on an assistant message:
      // while the model is still working there is no assistant message element
      // at all (measured: data-message-author-role="assistant" count is 0 mid
      // generation), so anchoring there captured nothing for the entire period
      // the reasoning is actually interesting.
      const turns = [...document.querySelectorAll('[data-turn-id]')];
      const panel = turns[turns.length - 1] || null;
      if (panel) {
        const banned = ['pre', 'code', '.markdown', '.sr-only', '[data-message-author-role]'];
        const rows = [];
        const seen = new Set();
        for (const node of panel.querySelectorAll('span, div')) {
          if (rows.length >= ${VISIBLE_REASONING_MAX_ROWS}) break;
          if (node.children.length) continue;
          let excluded = false;
          for (const selector of banned) { try { if (node.closest(selector)) { excluded = true; break } } catch { /* ignore */ } }
          if (excluded) continue;
          const value = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
          if (value.length < ${VISIBLE_REASONING_MIN_CHARS} || value.length > ${VISIBLE_REASONING_MAX_CHARS}) continue;
          const key = value.toLocaleLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(value);
        }
        // A wrapper reports the concatenation of the rows beneath it; anything
        // that strictly contains another candidate is that wrapper, not a step.
        const steps = rows.filter((row) => !rows.some((other) => other !== row && row.includes(other)));
        text = steps.map((row) => '- ' + row).join('\\n');
      }
    } catch { /* reasoning is optional; liveness is not */ }

    return { state, text, capturedAt: new Date().toISOString() };
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
