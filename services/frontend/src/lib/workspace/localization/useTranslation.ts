import { useSyncExternalStore } from 'react'
import { interfaceLocale, subscribeLocale } from './locale'
import { translate } from './translation'
export function useTranslation() {
  const locale = useSyncExternalStore(subscribeLocale, interfaceLocale, () => 'en' as const)
  return (source: string) => translate(source, locale)
}
