import { useSyncExternalStore, type ReactNode } from 'react'
import { interfaceLocale, subscribeLocale } from './locale'
/** Rerender without changing keys: editor models, PTYs and workspace state remain mounted. */
export function LocaleRoot({ children }: { children: () => ReactNode }) {
  useSyncExternalStore(subscribeLocale, interfaceLocale, () => 'en' as const)
  return children()
}
