import { script } from '../chat-agent-script-builder.mjs'

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
    // A selected level may contain an icon and therefore is not a leaf.
    // Keep the leaf lookup and add only direct text nodes of visible inline
    // wrappers in this control; never use a wrapper's concatenated content.
    const nodes = [candidates[0], ...candidates[0].querySelectorAll('*')].slice(0, 64)
      .filter((node) => usable(node) && vis(node));
    const leaves = nodes.filter((node) => node === candidates[0] || node.children.length === 0)
      .map((node) => fold(text(node)).slice(0, 120));
    const inline = nodes.filter((node) => node !== candidates[0] && node.children.length > 0)
      .map((node) => fold([...(node.childNodes || [])].slice(0, 64)
        .filter((child) => child.nodeType === 3).map((child) => String(child.textContent || '').slice(0, 120)).join(' ')).slice(0, 120));
    const labels = [...new Set([...leaves, ...inline].filter(Boolean))];
    const matches = __whx.effortLevels.filter((level) => level.labels.some((value) => labels.includes(fold(value))));
    if (matches.length !== 1) return { ok: false, state: 'effort-level-unknown', labels: labels.slice(0, 8).map((label) => label.slice(0, 120)) };
    return { ok: true, state: 'effort-level-read', effort: matches[0].id };
  `)
}
