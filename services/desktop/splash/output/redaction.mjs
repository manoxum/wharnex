const SENSITIVE = /(?:api[_-]?key|token|secret|password|passwd|credential|authorization|cookie|private[_-]?key)/i
export function createOutputRedactor(environment = {}, { maxLength = 2000 } = {}) {
  const secrets = Object.entries(environment).filter(([key, value]) => SENSITIVE.test(key) && String(value).length >= 4)
    .map(([, value]) => String(value)).sort((a, b) => b.length - a.length)
  let privateKey = false
  return (input) => {
    if (/-----BEGIN .*PRIVATE KEY-----/.test(String(input))) privateKey = true
    if (privateKey) {
      if (/-----END .*PRIVATE KEY-----/.test(String(input))) privateKey = false
      return '[REDACTED]'
    }
    let text = String(input).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
    text = text.replace(/((?:authorization|cookie)["']?\s*[:=]\s*)[^\n]+/gi, '$1[REDACTED]')
      .replace(/((?:api[_-]?key|[\w-]*(?:token|secret|password|passwd|credential)|authorization|cookie|private[_-]?key)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
      .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, '[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    return text.slice(0, maxLength)
  }
}
