// DOM scripts built from a behavior document.
//
// Nothing here hardcodes a selector: every lookup is driven by the behavior the
// agent was instantiated with, which is what allows a UI change (or a different
// provider) to be absorbed by shipping a document instead of editing code.
//
// Scripts observe and stage. They never click: ChatGPT's menu controls ignore
// synthetic clicks, so activation is a trusted native event issued by the main
// process against the rect a script returns (ADR-0037).

const json = (value) => JSON.stringify(value)

// Shared helpers injected into every script. `rect` returns a viewport-relative
// centre, or null when the control is outside the viewport and therefore not a
// safe native-click target.
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
  const rect = (n) => { const r = n.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return (x < 0 || y < 0 || x > innerWidth || y > innerHeight) ? null : { x, y, width: Math.round(r.width), height: Math.round(r.height) }; };
  const text = (n) => String(n?.getAttribute?.('aria-label') || n?.getAttribute?.('title') || n?.textContent || '').replace(/\\s+/g, ' ').trim();
  const fold = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
`

function script(behavior, body) {
  const context = json({ selectors: behavior.selectors, labels: behavior.labels })
  return `(() => { const __whx = ${context};${PRELUDE}\n${body}\n})()`
}

/** Structural readiness: is this a usable chat surface right now? */
export function readinessScript(behavior) {
  return script(behavior, `
    const composer = pick(S.composer);
    const stop = pick(S.stopButton);
    const error = all(S.errorNotice).length;
    return {
      url: location.href,
      ready: Boolean(composer),
      generating: Boolean(stop),
      assistantTurns: all(S.assistantTurn).length,
      conversationTurns: all(S.conversationTurn).length,
      errorNotices: error,
      title: String(document.title || ''),
    };
  `)
}

/**
 * Inspection result for one conversation.
 *
 * Deliberately structural: turn counts, control presence and error affordances.
 * It never reads assistant prose, so it can classify "finished", "still
 * generating" or "errored" without inspecting what was generated.
 */
export function inspectScript(behavior) {
  return script(behavior, `
    const composer = pick(S.composer);
    const stop = pick(S.stopButton);
    const errors = all(S.errorNotice).map((n) => ({ role: n.getAttribute('role') || '', testid: n.getAttribute('data-testid') || '' }));
    const assistant = all(S.assistantTurn);
    const last = assistant[assistant.length - 1] || null;
    return {
      url: location.href,
      ready: Boolean(composer),
      generating: Boolean(stop),
      assistantTurns: assistant.length,
      lastAssistantId: last ? String(last.getAttribute('data-message-id') || '') : '',
      errorNotices: errors,
      state: stop ? 'generating' : errors.length ? 'error' : composer ? 'idle' : 'unavailable',
    };
  `)
}

/** Stages composer text. Submission itself is a trusted native key event. */
export function fillComposerScript(behavior, value) {
  return script(behavior, `
    const value = ${json(String(value ?? ''))};
    const node = pick(S.composer);
    if (!node) return { ok: false, state: 'composer-unavailable' };
    node.focus();
    if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(node.constructor.prototype, 'value')?.set;
      if (setter) setter.call(node, value); else node.value = value;
    } else {
      node.textContent = '';
      const doc = node.ownerDocument;
      const p = doc.createElement('p');
      p.textContent = value;
      node.appendChild(p);
    }
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    const send = pick(S.sendButton);
    return { ok: true, state: 'composer-filled', length: value.length, sendRect: send ? rect(send) : null };
  `)
}

/** Confirms the composer actually drained, which is the page's own send evidence. */
export function composerStateScript(behavior) {
  return script(behavior, `
    const node = pick(S.composer);
    if (!node) return { ok: false, state: 'composer-unavailable' };
    const value = node.tagName === 'TEXTAREA' || node.tagName === 'INPUT' ? String(node.value || '') : String(node.textContent || '');
    return { ok: true, state: 'composer-read', empty: value.trim().length === 0, length: value.trim().length };
  `)
}

export function openConversationMenuScript(behavior, conversationId = '') {
  return script(behavior, `
    const id = ${json(String(conversationId || ''))};
    const owned = id ? all(S.conversationOptionsTrigger).find((n) => n.getAttribute('data-conversation-options-trigger') === id) : null;
    const header = pick(S.conversationOptionsHeader);
    const trigger = [owned, header].find((n) => n && usable(n) && vis(n));
    if (!trigger) return { ok: false, state: 'menu-unavailable' };
    trigger.click();
    return { ok: true, state: 'menu-opened', boundToConversation: trigger === owned };
  `)
}

export function menuItemRectScript(behavior, labelKey) {
  return script(behavior, `
    const wanted = L[${json(labelKey)}] || [];
    const items = all(S.menuItem).filter(usable);
    if (!items.length) return { ok: false, state: 'menu-not-open' };
    const item = items.find((n) => wanted.includes(fold(text(n)))) || items.find((n) => wanted.some((w) => fold(text(n)).startsWith(w)));
    if (!item) return { ok: false, state: 'action-unavailable', available: items.map(text).slice(0, 12) };
    const point = rect(item);
    return point ? { ok: true, state: 'action-located', rect: point } : { ok: false, state: 'action-offscreen' };
  `)
}

export function projectItemRectScript(behavior, projectName) {
  return script(behavior, `
    const wanted = fold(${json(String(projectName || ''))});
    const anchors = all(S.projectAnchor);
    const matches = anchors.filter((n) => fold(text(n)) === wanted);
    if (!matches.length) return { ok: false, state: 'project-missing', count: anchors.length };
    const point = rect(matches[0]);
    return point
      ? { ok: true, state: 'project-located', rect: point, duplicates: matches.length, href: matches[0].getAttribute('href') || '' }
      : { ok: false, state: 'project-offscreen' };
  `)
}

export function titleEditorScript(behavior, title) {
  return script(behavior, `
    const value = ${json(String(title ?? ''))};
    const input = pick(S.titleEditor);
    if (!input) return { ok: false, state: 'title-input-unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus(); input.select?.();
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, state: 'title-staged', rect: rect(input), title: value };
  `)
}

/**
 * Captures a bounded structural snapshot when something unexpected happens.
 *
 * Attribute names and control shapes only — no text nodes — so a snapshot kept
 * for behavior evolution can never carry conversation content.
 */
export function anomalyCaptureScript(behavior) {
  const selectors = json(behavior.anomaly.captureSelectors)
  const limit = Number(behavior.anomaly.maxCaptureBytes) || 262_144
  return script(behavior, `
    const roots = ${selectors};
    const describe = (node, depth) => {
      if (!node || node.nodeType !== 1 || depth < 0) return null;
      const attrs = {};
      for (const a of node.attributes || []) {
        if (a.name === 'style') continue;
        attrs[a.name] = String(a.value).slice(0, 120);
      }
      return { tag: node.tagName.toLowerCase(), attrs, children: [...node.children].slice(0, 24).map((c) => describe(c, depth - 1)).filter(Boolean) };
    };
    const snapshot = { url: location.href, title: String(document.title || '').slice(0, 200), roots: [] };
    for (const sel of roots) { const n = document.querySelector(sel); if (n) snapshot.roots.push({ selector: sel, tree: describe(n, 4) }) }
    const encoded = JSON.stringify(snapshot);
    return encoded.length > ${limit} ? { truncated: true, url: snapshot.url, title: snapshot.title, roots: snapshot.roots.slice(0, 1) } : snapshot;
  `)
}
