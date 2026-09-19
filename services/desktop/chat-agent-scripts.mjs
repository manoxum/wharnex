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
  const measure = (n) => { const r = n.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return (x < 0 || y < 0 || x > innerWidth || y > innerHeight) ? null : { x, y, width: Math.round(r.width), height: Math.round(r.height) }; };
  // A control that exists, is usable and has real geometry but sits outside the
  // viewport is scrolled to, not given up on. The sidebar conversation list and
  // the project picker are both scrollable, so the wanted row is routinely
  // below the fold; refusing to measure it reported action-offscreen and failed
  // the whole account operation over a control that was one scroll away.
  // Scrolling is not activation: the trusted native click still happens in the
  // main process against the rect returned here, so fail-closed is preserved —
  // a control that is still outside the viewport after scrolling yields null.
  const rect = (n) => {
    const first = measure(n);
    if (first) return first;
    // 'instant' matters: ChatGPT sets scroll-behavior smooth on its scrollers,
    // and a smooth scroll has not landed by the time the next line measures.
    try { n.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) } catch { try { n.scrollIntoView(true) } catch { return null } }
    return measure(n);
  };
  // Reported with every offscreen failure so a slot that simply has no layout
  // viewport (0x0) is never again indistinguishable from a control that is
  // genuinely scrolled out of view. Both are control geometry, never content.
  const viewport = () => ({ w: innerWidth, h: innerHeight });
  const text = (n) => String(n?.getAttribute?.('aria-label') || n?.getAttribute?.('title') || n?.textContent || '').replace(/\\s+/g, ' ').trim();
  const fold = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
`

function script(behavior, body) {
  const context = json({
    selectors: behavior.selectors,
    optionalSelectors: behavior.optionalSelectors,
    labels: behavior.labels,
    effortLevels: behavior.effortLevels,
  })
  return `(() => { const __whx = ${context};${PRELUDE}\n${body}\n})()`
}

/**
 * Reads only the composer effort pill's UI-chrome label.
 *
 * This is intentionally narrower than a generic menu scraper: the composer is
 * located first, candidates must belong to that exact composer surface, and an
 * ambiguous or unknown control fails closed. The script never activates the
 * control and never reads conversation content.
 */
export function reasoningEffortStateScript(behavior) {
  return script(behavior, `
    const composer = pick(S.composer);
    const surface = composer?.closest?.('[data-composer-surface]');
    if (!surface) return { ok: false, state: 'effort-composer-unavailable' };
    const candidates = all(__whx.optionalSelectors.effortPicker)
      .filter((node) => usable(node) && surface.contains(node));
    if (candidates.length !== 1) return { ok: false, state: candidates.length ? 'effort-control-ambiguous' : 'effort-control-unavailable', count: candidates.length };
    const label = fold(text(candidates[0]));
    const matches = __whx.effortLevels.filter((level) => level.labels.some((value) => fold(value) === label));
    if (matches.length !== 1) return { ok: false, state: 'effort-level-unknown' };
    return { ok: true, state: 'effort-level-read', effort: matches[0].id };
  `)
}

/**
 * Locates the reasoning-effort control's next actionable step and stages it.
 *
 * The control is two things in sequence: a composer button that must be
 * opened (a trusted native click, like every other account/menu control -
 * ADR-0037), and then an ARIA slider inside the opened menu that is driven by
 * ArrowLeft/ArrowRight once focused. Focusing here is staging, not
 * activation - the same class of inert DOM action `rect()`'s own
 * `scrollIntoView` already performs - and it never itself changes the
 * reasoning-effort value; only the native key press the main process sends
 * next does that.
 */
export function reasoningEffortAdjustScript(behavior) {
  return script(behavior, `
    const composer = pick(S.composer);
    const surface = composer?.closest?.('[data-composer-surface]');
    if (!surface) return { ok: false, state: 'effort-composer-unavailable' };
    const button = all(__whx.optionalSelectors.effortPicker)
      .filter((node) => usable(node) && surface.contains(node));
    if (button.length !== 1) return { ok: false, state: button.length ? 'effort-control-ambiguous' : 'effort-control-unavailable' };
    if (button[0].getAttribute('aria-expanded') !== 'true') {
      const target = rect(button[0]);
      return target ? { ok: true, state: 'effort-menu-closed', rect: target, viewport: viewport() } : { ok: false, state: 'effort-control-offscreen', viewport: viewport() };
    }
    const slider = pick(__whx.optionalSelectors.effortSlider);
    if (!slider) return { ok: false, state: 'effort-slider-unavailable' };
    const valueNow = Number(slider.getAttribute('aria-valuenow'));
    const valueMax = Number(slider.getAttribute('aria-valuemax'));
    if (!Number.isInteger(valueNow) || !Number.isInteger(valueMax)) return { ok: false, state: 'effort-slider-value-unknown' };
    slider.focus();
    if (document.activeElement !== slider) return { ok: false, state: 'effort-slider-not-focusable' };
    return { ok: true, state: 'effort-slider-ready', valueNow, valueMax };
  `)
}

/** Structural readiness: is this a usable chat surface right now? */
export function readinessScript(behavior) {
  return script(behavior, `
    const composer = pick(S.composer);
    const stop = pick(S.stopButton);
    const error = all(S.errorNotice).filter((n) => String(n.textContent || '').trim().length > 0).length;
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
    // An empty alert region is chrome that ChatGPT keeps mounted; only a
    // notice that actually carries content is evidence of a failure.
    const errors = all(S.errorNotice)
      .filter((n) => String(n.textContent || '').trim().length > 0)
      .map((n) => ({ role: n.getAttribute('role') || '', testid: n.getAttribute('data-testid') || '' }));
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

/** Stages composer text without changing the focused WebContents. */
export function fillComposerScript(behavior, value) {
  return script(behavior, `
    const value = ${json(String(value ?? ''))};
    const node = pick(S.composer);
    if (!node) return { ok: false, state: 'composer-unavailable' };
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
    return point ? { ok: true, state: 'action-located', rect: point } : { ok: false, state: 'action-offscreen', viewport: viewport() };
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
      : { ok: false, state: 'project-offscreen', viewport: viewport() };
  `)
}

export function titleEditorScript(behavior, title) {
  return script(behavior, `
    const value = ${json(String(title ?? ''))};
    const input = pick(S.titleEditor);
    if (!input) return { ok: false, state: 'title-input-unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, state: 'title-staged', rect: rect(input), title: value };
  `)
}

/** Locates the collapsed reasoning disclosure so the main process can expand it. */
export function reasoningDisclosureRectScript(behavior) {
  return script(behavior, `
    const wanted = L.reasoningDisclosure || [];
    const buttons = all(__whx.optionalSelectors.reasoningDisclosure).filter(usable);
    const target = buttons.find((n) => wanted.some((w) => fold(text(n)).startsWith(w)));
    if (!target) return { ok: false, state: 'reasoning-disclosure-unavailable' };
    const expanded = target.getAttribute('aria-expanded') === 'true';
    const point = rect(target);
    if (!point) return { ok: false, state: 'reasoning-disclosure-offscreen', viewport: viewport() };
    return { ok: true, state: expanded ? 'reasoning-expanded' : 'reasoning-collapsed', expanded, rect: point, label: text(target).slice(0, 120) };
  `)
}

/**
 * Extracts the visible reasoning summary rows.
 *
 * "Useful" is decided structurally, never by reading what a row says. A row is
 * kept when it is a short prose line that is not inside (and does not contain) a
 * code or markdown region, and is not the answer itself. That is precisely the
 * difference between "Validou estilos e temas da interface" — which belongs in
 * the visible-reasoning panel — and the tool/code block sitting beside it, which
 * does not.
 */
export function reasoningRowsScript(behavior) {
  const config = json(behavior.reasoning)
  const excluded = json(behavior.reasoning.excludeWithin)
  return script(behavior, `
    const cfg = ${config};
    const banned = ${excluded};
    if (!cfg.enabled) return { ok: false, state: 'reasoning-disabled' };

    // Reasoning is readable in two different shapes, and only handling one of
    // them is why a live run appeared to produce nothing. While the model is
    // still working the steps stream directly into the turn; once it finishes
    // they collapse behind a "Processou durante …" disclosure.
    const disclosureLabels = L.reasoningDisclosure || [];
    const buttons = all(__whx.optionalSelectors.reasoningDisclosure);
    const disclosure = buttons.find((n) => disclosureLabels.some((w) => fold(text(n)).startsWith(w)));

    let panel = null;
    let mode = 'live';
    if (disclosure) {
      if (disclosure.getAttribute('aria-expanded') !== 'true') return { ok: false, state: 'reasoning-collapsed', rect: rect(disclosure) };
      const controls = disclosure.getAttribute('aria-controls');
      panel = (controls && document.getElementById(controls)) || disclosure.parentElement?.parentElement;
      mode = 'completed';
    } else {
      // Live: the steps live inside the newest assistant turn.
      const turns = all(S.assistantTurn);
      const last = turns[turns.length - 1];
      panel = last ? (last.closest('[data-turn-id]') || last.parentElement) : document.querySelector('main');
    }
    if (!panel) return { ok: false, state: 'reasoning-panel-unavailable' };

    const isCode = (n) => banned.some((sel) => { try { return n.closest(sel) || n.querySelector(sel) } catch { return false } });
    const rows = [];
    const seen = new Set();
    for (const node of panel.querySelectorAll('*')) {
      if (rows.length >= cfg.maxRows) break;
      if (disclosure && (node === disclosure || disclosure.contains(node))) continue;
      // Only leaf-ish nodes: a wrapper repeats every child's text.
      if (node.children.length > 1) continue;
      if (isCode(node)) continue;
      // Screen-reader-only chrome ("ChatGPT said:") is markup for assistive
      // technology, not a reasoning step.
      if (node.closest('.sr-only')) continue;
      const value = text(node);
      if (value.length < cfg.minRowChars || value.length > cfg.maxRowChars) continue;
      if (/^[\\s\\W]*$/.test(value)) continue;
      const key = fold(value);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(value);
    }
    // A wrapper element reports the concatenation of the rows beneath it, which
    // arrives looking like one very long "thought". Any candidate that strictly
    // contains another candidate is that wrapper, not a row of its own.
    const leaves = rows.filter((row) => !rows.some((other) => other !== row && row.includes(other)));
    return { ok: true, state: 'reasoning-read', label: text(disclosure).slice(0, 120), rows: leaves };
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
