import { script } from './chat-agent-script-builder.mjs'

// Reads only the active composer's effort pill. Current definitive-chat forms
// use data-chatgpt-composer and split the control title from the selected level
// into separate leaf spans, so matching stays inside this one chrome control.
export function reasoningEffortStateScript(behavior) {
  return script(behavior, `
    const composer = pick(S.composer);
    const surface = composer?.closest?.('[data-composer-surface]') || composer?.closest?.('form[data-chatgpt-composer]');
    if (!surface) return { ok: false, state: 'effort-composer-unavailable' };
    const candidates = all(__whx.optionalSelectors.effortPicker)
      .filter((node) => usable(node) && surface.contains(node));
    if (candidates.length !== 1) return { ok: false, state: candidates.length ? 'effort-control-ambiguous' : 'effort-control-unavailable', count: candidates.length };
    const labels = [candidates[0], ...candidates[0].querySelectorAll('*')]
      .filter((node) => node === candidates[0] || node.children.length === 0)
      .map((node) => fold(text(node))).filter(Boolean);
    const matches = __whx.effortLevels.filter((level) => level.labels.some((value) => labels.includes(fold(value))));
    if (matches.length !== 1) return { ok: false, state: 'effort-level-unknown' };
    return { ok: true, state: 'effort-level-read', effort: matches[0].id };
  `)
}

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
    const slider = pick(__whx.optionalSelectors.effortSlider);
    if (!slider) {
      const target = rect(button[0]);
      if (!target) return { ok: false, state: 'effort-control-offscreen', viewport: viewport() };
      button[0].focus();
      const hit = document.elementFromPoint(target.x, target.y);
      const shape = (n) => n ? { tag: n.tagName, role: n.getAttribute('role') || '', testid: n.getAttribute('data-testid') || '' } : null;
      return {
        ok: true, state: 'effort-menu-closed', rect: target, viewport: viewport(),
        triggerFocused: document.activeElement === button[0],
        triggerExpanded: button[0].getAttribute('aria-expanded') === 'true',
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
