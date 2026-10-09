import { composerLookupSource } from './chatgpt-composer-lookup.mjs'

// Closed diagnostic control: bounded composer chrome and turn structure only.
export const COMPOSER_TRANSPORT_PROBE = `
  ${composerLookupSource()}
  const surface = composer?.closest('[data-composer-surface]') || composer?.closest('form');
  const buttons = [...(surface?.querySelectorAll('button') || [])].slice(0, 16);
  return {
    control: 'composer-transport', viewport: { w: innerWidth, h: innerHeight },
    composers: document.querySelectorAll('#prompt-textarea').length,
    composerReady: Boolean(composer),
    turnWrappers: document.querySelectorAll('[data-turn-id]').length,
    streaming: document.querySelectorAll('.result-streaming').length,
    agentTurnStarts: document.querySelectorAll('[data-chatgpt-agent-turn-start]').length,
    userMessages: document.querySelectorAll('[class~="group/user-message"]').length,
    resourceCards: document.querySelectorAll('[class~="group/resource-card"]').length,
    controls: buttons.map((node) => ({
      tag: node.tagName, role: node.getAttribute('role') || '',
      ariaLabel: (node.getAttribute('aria-label') || '').slice(0, 120),
      title: (node.getAttribute('title') || '').slice(0, 120),
      label: label(node),
      testid: (node.getAttribute('data-testid') || '').slice(0, 120),
      popup: node.getAttribute('aria-haspopup') || '',
      disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
      expanded: node.getAttribute('aria-expanded') === 'true',
      visible: visible(node),
    })),
  };
`

export const REASONING_EFFORT_PROBE = `
  const composers = [...document.querySelectorAll('#prompt-textarea, div[contenteditable="true"][role="textbox"], textarea[name="prompt-textarea"]')].filter((node) => usable(node) && visible(node));
  const surfaces = composers.map((node) => node.closest('[data-composer-surface]') || node.closest('form[data-chatgpt-composer]')).filter(Boolean);
  const controls = surfaces.flatMap((surface) => [...surface.querySelectorAll('button[aria-haspopup="menu"]:not([data-testid])')]).filter((node) => usable(node) && visible(node));
  return {
    control: 'reasoning-effort', viewport: viewport(), composers: composers.length,
    surfaces: surfaces.length, controls: controls.length,
    labels: controls.slice(0, 16).map((node) => ({ label: label(node), title: String(node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120), role: node.getAttribute('role') || '', expanded: node.getAttribute('aria-expanded') === 'true' })),
  };
`
