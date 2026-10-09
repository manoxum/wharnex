import { script } from './chat-agent-script-builder.mjs'

export { reasoningEffortStateScript } from './reasoning/index.mjs'

// Stages the effort control. Activation remains a trusted native main-process
// action; this expression only returns geometry or focuses the ARIA slider.
export function reasoningEffortAdjustScript(behavior) {
  return script(behavior, `
    const composer = pick(S.composer);
    const surface = composer?.closest?.('[data-composer-surface]') || composer?.closest?.('form[data-chatgpt-composer]');
    if (!surface) return { ok: false, state: 'effort-composer-unavailable' };
    const button = all(__whx.optionalSelectors.effortPicker)
      .filter((node) => usable(node) && surface.contains(node));
    if (button.length !== 1) return { ok: false, state: button.length ? 'effort-control-ambiguous' : 'effort-control-unavailable' };
    // An open trigger must never be pressed again: a second press closes it,
    // which is how the Worker used to toggle the menu open and shut. Its slider
    // is looked up inside the menu that trigger controls (or the one open menu)
    // when the mapped selectors miss it.
    const expanded = button[0].getAttribute('aria-expanded') === 'true' || button[0].getAttribute('data-state') === 'open';
    const controlled = button[0].getAttribute('aria-controls');
    const owned = controlled ? document.getElementById(controlled) : null;
    const scopes = owned ? [owned] : [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]')];
    let slider = pick(__whx.optionalSelectors.effortSlider);
    if (!slider && expanded) {
      const inside = [...new Set(scopes.flatMap((scope) => [...scope.querySelectorAll('[role="slider"]')]))].filter(vis);
      if (inside.length === 1) slider = inside[0];
    }
    if (!slider) {
      const sliders = [...document.querySelectorAll('[role="slider"]')].slice(0, 3).map((n) => ({
        usable: usable(n), visible: vis(n), now: (n.getAttribute('aria-valuenow') || '').slice(0, 8), max: (n.getAttribute('aria-valuemax') || '').slice(0, 8),
        disabled: n.getAttribute('aria-disabled') === 'true' || n.hasAttribute('data-disabled'), inMenu: scopes.some((scope) => scope.contains(n)),
        hiddenBy: (n.closest('[hidden], [aria-hidden="true"], [inert]')?.tagName || '').slice(0, 16),
      }));
      if (expanded) return { ok: true, state: 'effort-menu-open-no-slider', triggerExpanded: true, controlled: Boolean(owned), scopes: scopes.length, sliders };
      const target = rect(button[0]);
      if (!target) return { ok: false, state: 'effort-control-offscreen', viewport: viewport() };
      button[0].focus();
      const hit = document.elementFromPoint(target.x, target.y);
      const shape = (n) => n ? { tag: n.tagName, role: n.getAttribute('role') || '', testid: n.getAttribute('data-testid') || '' } : null;
      return {
        ok: true, state: 'effort-menu-closed', rect: target, viewport: viewport(), sliders,
        triggerFocused: document.activeElement === button[0],
        triggerExpanded: expanded,
        triggerDisabled: button[0].matches(':disabled') || button[0].getAttribute('aria-disabled') === 'true',
        triggerState: (button[0].getAttribute('data-state') || '').slice(0, 32),
        triggerPointerEvents: getComputedStyle(button[0]).pointerEvents.slice(0, 16),
        sliderCount: document.querySelectorAll('[role="slider"]').length,
        openMenuCount: document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]').length,
        hit: shape(hit), hitIsControl: Boolean(hit && (hit === button[0] || button[0].contains(hit) || hit.contains(button[0]))),
      };
    }
    const valueNow = Number(slider.getAttribute('aria-valuenow'));
    const valueMax = Number(slider.getAttribute('aria-valuemax'));
    if (!Number.isInteger(valueNow) || !Number.isInteger(valueMax)) return { ok: false, state: 'effort-slider-value-unknown' };
    slider.focus();
    if (document.activeElement !== slider) return { ok: false, state: 'effort-slider-not-focusable' };
    return { ok: true, state: 'effort-slider-ready', valueNow, valueMax };
  `)
}
