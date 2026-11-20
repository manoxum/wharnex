/** Read-only locale metadata; never expose process environment or browser state. */
export function systemLanguages(app) {
  try {
    const preferred = app.getPreferredSystemLanguages?.()
    const languages = Array.isArray(preferred) && preferred.length ? preferred : [app.getLocale?.()]
    return [...new Set(languages.filter((value) => typeof value === 'string' && /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(value) && value.length <= 64))].slice(0, 8)
  } catch { return [] }
}
