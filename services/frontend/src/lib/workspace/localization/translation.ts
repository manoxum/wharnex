import { interfaceLocale, type InterfaceLocale } from './locale'
import { english } from './catalogs'
/** Only explicitly authored interface messages belong here. Never translate documents, paths or provider output. */
export function translate(source: string, locale: InterfaceLocale = interfaceLocale()): string {
  if (locale === 'pt') return source
  return english[source] ?? source
}

export function formatMessage(source: string, values: Record<string, string | number>, locale = interfaceLocale()): string {
  return translate(source, locale).replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(values, key) ? String(values[key]) : token)
}
