const ACTIONS = new Set(['navigate', 'click', 'fill', 'fill_credential', 'press', 'wait', 'assert_text', 'finish'])
const KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Space'])

export function parseUIAction(text) {
  const fence = String.fromCharCode(96).repeat(3); let raw = String(text || '').trim(); if (raw.startsWith(fence)) raw = raw.slice(fence.length).replace(/^json\s*/i, '').trimStart(); if (raw.endsWith(fence)) raw = raw.slice(0, -fence.length).trimEnd()
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value) || !ACTIONS.has(value.action)) throw new Error('GPT returned an unsupported UI action')
  const out = { action: value.action, caption: bounded(value.caption, 240) }
  if (['click', 'fill', 'fill_credential', 'press', 'assert_text'].includes(out.action)) out.selector = selector(value.selector)
  if (out.action === 'fill') out.value = bounded(value.value, 4000)
  if (out.action === 'fill_credential') {
    if (!['username', 'password'].includes(value.field)) throw new Error('credential action requires username or password')
    out.field = value.field
  }
  if (out.action === 'press') {
    if (!KEYS.has(value.key)) throw new Error('UI key is not allowed')
    out.key = value.key
  }
  if (out.action === 'navigate') out.url = bounded(value.url, 2048)
  if (out.action === 'wait') out.ms = Math.max(50, Math.min(5000, Number(value.ms) || 500))
  if (out.action === 'assert_text') out.text = bounded(value.text, 500)
  if (out.action === 'finish') out.status = value.status === 'passed' ? 'passed' : 'failed'
  return out
}

export async function executeUIAction(wc, action, { origin, credentials, wait }) {
  if (action.action === 'finish') return { done: true, status: action.status, outcome: action.caption || action.status }
  if (action.action === 'wait') { await wait(action.ms); return { outcome: `waited ${action.ms}ms` } }
  if (action.action === 'navigate') {
    const current = wc.getURL() || origin
    const target = new URL(action.url, current)
    if (target.origin !== origin) throw new Error('GPT navigation attempted to leave the configured environment origin')
    await wc.loadURL(target.toString()); return { outcome: `navigated to ${target.pathname}${target.search}` }
  }
  const materialized = action.action === 'fill_credential' ? { ...action, action: 'fill', value: credentials?.[action.field] || '' } : action
  if (action.action === 'fill_credential' && !materialized.value) throw new Error(`credential ${action.field} is not configured`)
  const result = await wc.executeJavaScript(uiActionScript(materialized), true)
  if (!result?.ok) throw new Error(String(result?.error || 'typed UI action failed'))
  return { outcome: String(result.outcome || 'ok') }
}

function uiActionScript(action) {
  const encoded = JSON.stringify(action).replace(/</g, '\\u003c')
  return `(() => { const a=${encoded}; try { const el=document.querySelector(a.selector); if(!el) return {ok:false,error:'selector not found: '+a.selector}; if(a.action==='click'){el.click();return {ok:true,outcome:'clicked '+a.selector}} if(a.action==='fill'){el.focus(); const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set; if(setter)setter.call(el,a.value);else el.value=a.value; el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,outcome:'filled '+a.selector}} if(a.action==='press'){el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:a.key,bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:a.key,bubbles:true}));return {ok:true,outcome:'pressed '+a.key}} if(a.action==='assert_text'){const actual=(el.textContent||'').trim();return actual.includes(a.text)?{ok:true,outcome:'asserted text'}:{ok:false,error:'expected text not found'}} return {ok:false,error:'unsupported action'} } catch(e){ return {ok:false,error:String(e?.message||e)} } })()`
}

function bounded(value, max) { const text = String(value ?? '').trim(); if (text.length > max) throw new Error('UI action field exceeds its bound'); return text }
function selector(value) { const text = bounded(value, 500); if (!text) throw new Error('UI action selector is required'); return text }
