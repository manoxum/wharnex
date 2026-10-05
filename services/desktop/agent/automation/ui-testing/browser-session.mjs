// Browser state a passed UI test leaves behind: the page it ended on plus the
// environment origin's cookies and web storage. It can hold authentication
// tokens, so it travels only to the backend's task-bound session endpoint,
// which seals it; it is never logged or shown to GPT.

const MAX_COOKIES = 200
const SAME_SITE = new Set(['unspecified', 'no_restriction', 'lax', 'strict'])

const CAPTURE_STORAGE_SCRIPT = `(() => {
  const dump = (read) => { const out = {}; try { const store = read(); for (let i = 0; i < store.length && i < 500; i += 1) { const key = store.key(i); if (key !== null) out[key] = String(store.getItem(key)) } } catch {} return out }
  return { url: location.href, local_storage: dump(() => window.localStorage), session_storage: dump(() => window.sessionStorage) }
})()`

export function domainMatches(host, domain) {
  const bare = String(domain || '').trim().replace(/^\./, '').toLowerCase()
  const name = String(host || '').toLowerCase()
  return !bare || name === bare || name.endsWith(`.${bare}`)
}

export async function captureBrowserState(wc, origin) {
  const page = await wc.executeJavaScript(CAPTURE_STORAGE_SCRIPT, true)
  if (!page?.url || new URL(page.url).origin !== origin) return null
  const host = new URL(origin).hostname
  const cookies = (await wc.session.cookies.get({}))
    .filter((cookie) => domainMatches(host, cookie.domain))
    .slice(0, MAX_COOKIES)
    .map((cookie) => ({
      name: cookie.name, value: cookie.value, domain: cookie.domain || '', path: cookie.path || '/',
      secure: Boolean(cookie.secure), http_only: Boolean(cookie.httpOnly), host_only: Boolean(cookie.hostOnly),
      expiration_date: Number(cookie.expirationDate || 0), same_site: SAME_SITE.has(cookie.sameSite) ? cookie.sameSite : '',
    }))
  return { url: page.url, cookies, local_storage: page.local_storage || {}, session_storage: page.session_storage || {} }
}

export async function restoreBrowserState(wc, environmentURL, state) {
  const entry = new URL(environmentURL)
  for (const cookie of state?.cookies || []) {
    const domain = String(cookie.domain || '').replace(/^\./, '') || entry.hostname
    if (!domainMatches(entry.hostname, domain)) continue
    const details = { url: `${entry.protocol}//${domain}${cookie.path || '/'}`, name: cookie.name, value: cookie.value, path: cookie.path || '/', secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.http_only) }
    if (!cookie.host_only && cookie.domain) details.domain = cookie.domain
    if (cookie.expiration_date) details.expirationDate = cookie.expiration_date
    if (SAME_SITE.has(cookie.same_site)) details.sameSite = cookie.same_site
    await wc.session.cookies.set(details).catch(() => undefined)
  }
  await wc.loadURL(entry.toString())
  await wc.executeJavaScript(restoreStorageScript(state), true)
  const resume = new URL(String(state?.url || entry), entry)
  await wc.loadURL(resume.origin === entry.origin ? resume.toString() : entry.toString())
}

export async function resetBrowserState(wc, environmentURL) {
  await wc.session.clearStorageData().catch(() => undefined)
  await wc.loadURL(new URL(environmentURL).toString())
}

function restoreStorageScript(state) {
  const encode = (value) => JSON.stringify(value && typeof value === 'object' ? value : {}).replace(/</g, '\\u003c')
  return `((local, session) => {
    try { for (const [key, value] of Object.entries(local)) window.localStorage.setItem(key, String(value)) } catch {}
    try { for (const [key, value] of Object.entries(session)) window.sessionStorage.setItem(key, String(value)) } catch {}
    return true
  })(${encode(state?.local_storage)}, ${encode(state?.session_storage)})`
}
