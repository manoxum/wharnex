// Behavior probe for the ChatGPT account-automation controls (see adr/ADR-0041).
//
// This exists because a stale selector or label set is indistinguishable, from
// the outside, from a broken automation: both surface as `action-unavailable`
// with nothing to act on. The probe measures the controls the automation
// already depends on, so the operator can correct them from evidence instead of
// guessing.
//
// It is deliberately NOT an "evaluate JavaScript in the ChatGPT view"
// capability, which `SoT/SECURITY_MODEL.md` forbids. Three properties keep it
// inside that boundary:
//
//   1. The caller names a control from a CLOSED enum. It never supplies a
//      selector, an expression, or any string that reaches the page.
//   2. Every script is built here from constants. Nothing about the probe is
//      caller-controlled, so there is no injection surface.
//   3. The result is bounded structural metadata: counts, geometry, control
//      roles/testids, and the exact menu-item labels the account automation is
//      already permitted to read (AGENTS.md §7). Assistant prose, conversation
//      content, cookies, storage, headers and hrefs never enter it.
//
// It is off unless explicitly enabled, so it is not a permanent surface.

export const BEHAVIOR_PROBE_SCHEMA = 'harness.behavior-probe/v1'

// The closed set of controls the account automation depends on. Adding one is a
// reviewed change, exactly like admitting a planner reason code.
export const BEHAVIOR_PROBE_CONTROLS = Object.freeze([
  'sidebar-toggle',
  'conversation-menu',
  'menu-items',
  'project-anchors',
  'project-dialog',
  'delete-dialog',
  'reasoning-effort',
])

const MAX_LABELS = 16
const MAX_LABEL_LENGTH = 120
const MAX_CONTAINERS = 8

export function isBehaviorProbeEnabled(env = process.env) {
  return String(env?.WHARNESS_BEHAVIOR_PROBE || '').trim() === '1'
}

export function sanitizeBehaviorProbeControl(value) {
  const control = String(value || '').trim()
  if (!BEHAVIOR_PROBE_CONTROLS.includes(control)) {
    throw new Error(`Unknown behavior probe control: ${control || '(empty)'}`)
  }
  return control
}

// Shared helpers. `label` is the same control-metadata reader the account
// scripts use; it is never applied to a conversation turn or assistant node.
const PRELUDE = `
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
    const usable = (node) => {
      if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.hidden || node.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
      const style = globalThis.getComputedStyle?.(node);
      return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
    };
    const label = (node) => String(node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || node?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_LABEL_LENGTH});
    const centred = (node) => { const r = node.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); return !(x < 0 || y < 0 || x > innerWidth || y > innerHeight); };
    const viewport = () => ({ w: innerWidth, h: innerHeight });
    // Structural identity of a container, never its content.
    const shape = (node) => ({
      tag: String(node.tagName || '').toLowerCase(),
      role: node.getAttribute('role') || '',
      testid: node.getAttribute('data-testid') || '',
      visible: visible(node),
    });
`

// Each entry is a complete, constant script body. No caller input is
// interpolated into any of them.
const PROBES = Object.freeze({
  'sidebar-toggle': `
    const selectors = ['button[data-testid="close-sidebar-button"]','button[data-testid="open-sidebar-button"]','button[data-testid="sidebar-toggle-button"]','button[aria-controls*="sidebar"]'];
    const found = selectors.map((selector) => ({ selector, matches: document.querySelectorAll(selector).length }));
    const sidebars = ['[data-testid="sidebar"]','nav[data-testid*="sidebar"]','aside[data-testid*="sidebar"]'].map((selector) => ({ selector, matches: document.querySelectorAll(selector).length }));
    return { control: 'sidebar-toggle', viewport: viewport(), selectors: found, sidebars };
  `,
  'conversation-menu': `
    const owned = [...document.querySelectorAll('[data-conversation-options-trigger]')];
    const header = [...document.querySelectorAll('button[data-testid="conversation-options-button"]')];
    const candidates = [...document.querySelectorAll('header button, main button[aria-haspopup="menu"], nav button[aria-haspopup="menu"], aside button[aria-haspopup="menu"]')]
      .filter((node) => usable(node) && visible(node));
    return {
      control: 'conversation-menu',
      viewport: viewport(),
      ownedTriggers: owned.length,
      ownedUsable: owned.filter((node) => usable(node) && visible(node)).length,
      headerTriggers: header.length,
      headerUsable: header.filter((node) => usable(node) && visible(node)).length,
      candidates: candidates.slice(0, ${MAX_LABELS}).map((node) => ({
        tag: String(node.tagName || '').toLowerCase(),
        role: node.getAttribute('role') || '',
        testid: node.getAttribute('data-testid') || '',
        ariaLabel: String(node.getAttribute('aria-label') || '').slice(0, ${MAX_LABEL_LENGTH}),
        title: String(node.getAttribute('title') || '').slice(0, ${MAX_LABEL_LENGTH}),
        popup: node.getAttribute('aria-haspopup') || '',
      })),
    };
  `,
  // The exact menu-item labels are what a stale label set has to be corrected
  // against. They are app chrome, which AGENTS.md §7 already permits the account
  // automation to read, and they are bounded here in both count and length.
  'menu-items': `
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const live = items.filter((node) => usable(node) && visible(node));
    return {
      control: 'menu-items',
      viewport: viewport(),
      total: items.length,
      usable: live.length,
      onScreen: live.filter(centred).length,
      labels: live.slice(0, ${MAX_LABELS}).map((node) => ({ label: label(node), submenu: node.getAttribute('aria-haspopup') === 'menu', testid: node.getAttribute('data-testid') || '' })),
    };
  `,
  // Project anchors are counted and shaped, never listed: a project name is the
  // user's own data and the automation already matches it by exact name.
  'project-anchors': `
    const anchors = [...document.querySelectorAll('a[role="menuitem"][href^="/g/g-p-"], a[href^="/g/g-p-"]')];
    return {
      control: 'project-anchors',
      viewport: viewport(),
      total: anchors.length,
      visible: anchors.filter(visible).length,
      withMenuRole: anchors.filter((node) => node.getAttribute('role') === 'menuitem').length,
    };
  `,
  'project-dialog': `
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const modals = [...document.querySelectorAll('[role="dialog"], [data-state="open"][role], dialog, [aria-modal="true"]')];
    const inputs = [...document.querySelectorAll('[role="dialog"] input, [aria-modal="true"] input')];
    return {
      control: 'project-dialog',
      viewport: viewport(),
      dialogs: dialogs.length,
      visibleDialogs: dialogs.filter(visible).length,
      modalShapes: modals.slice(0, ${MAX_CONTAINERS}).map(shape),
      inputs: inputs.length,
      usableInputs: inputs.filter((node) => usable(node) && visible(node)).length,
    };
  `,
  'delete-dialog': `
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const buttons = dialogs.flatMap((dialog) => [...dialog.querySelectorAll('button')]).filter((node) => usable(node) && visible(node));
    return {
      control: 'delete-dialog',
      viewport: viewport(),
      dialogs: dialogs.length,
      buttons: buttons.length,
      labels: buttons.slice(0, ${MAX_LABELS}).map((node) => ({ label: label(node), testid: node.getAttribute('data-testid') || '' })),
    };
  `,
  // Composer chrome only. This records the exact bounded labels needed to
  // validate the selector/locale mapping; it never traverses a chat turn.
  'reasoning-effort': `
    const composers = [...document.querySelectorAll('#prompt-textarea, div[contenteditable="true"][role="textbox"], textarea[name="prompt-textarea"]')].filter((node) => usable(node) && visible(node));
    const surfaces = composers.map((node) => node.closest('[data-composer-surface]') || node.closest('form[data-chatgpt-composer]')).filter(Boolean);
    const controls = surfaces.flatMap((surface) => [...surface.querySelectorAll('button[aria-haspopup="menu"]:not([data-testid])')]).filter((node) => usable(node) && visible(node));
    return {
      control: 'reasoning-effort',
      viewport: viewport(),
      composers: composers.length,
      surfaces: surfaces.length,
      controls: controls.length,
      labels: controls.slice(0, ${MAX_LABELS}).map((node) => ({ label: label(node), role: node.getAttribute('role') || '', expanded: node.getAttribute('aria-expanded') === 'true' })),
    };
  `,
})

export function behaviorProbeScript(control) {
  const name = sanitizeBehaviorProbeControl(control)
  return `(() => {${PRELUDE}${PROBES[name]}})()`
}

// Re-bounds the result in the main process, so a page that returns something
// unexpected cannot widen what crosses IPC. Anything not named here is dropped.
export function normalizeBehaviorProbeResult(control, raw) {
  const name = sanitizeBehaviorProbeControl(control)
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = { schema: BEHAVIOR_PROBE_SCHEMA, control: name, viewport: numberPair(source.viewport) }
  for (const [key, value] of Object.entries(source)) {
    if (key === 'control' || key === 'viewport') continue
    if (Number.isFinite(value)) out[key] = value
    else if (Array.isArray(value)) out[key] = value.slice(0, MAX_LABELS).map(entry)
  }
  return out
}

function numberPair(value) {
  const w = Number(value?.w)
  const h = Number(value?.h)
  return { w: Number.isFinite(w) ? w : -1, h: Number.isFinite(h) ? h : -1 }
}

function entry(value) {
  if (typeof value === 'string') return value.slice(0, MAX_LABEL_LENGTH)
  if (!value || typeof value !== 'object') return {}
  const out = {}
  for (const key of ['label', 'selector', 'tag', 'role', 'testid', 'ariaLabel', 'title', 'popup']) {
    if (typeof value[key] === 'string') out[key] = value[key].slice(0, MAX_LABEL_LENGTH)
  }
  for (const key of ['matches', 'total', 'visible', 'usable']) {
    if (Number.isFinite(value[key])) out[key] = value[key]
  }
  for (const key of ['submenu', 'visible', 'expanded']) {
    if (typeof value[key] === 'boolean') out[key] = value[key]
  }
  return out
}
