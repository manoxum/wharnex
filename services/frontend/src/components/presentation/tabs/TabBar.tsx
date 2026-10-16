import { useLayoutEffect, useRef, useState, type HTMLAttributes, type Ref } from 'react'
import type { TabAppearance } from './tabAppearance'
import { tabBarAppearance } from './tabBarAppearance'
import { tabDensity, type TabDensity } from './tabDensity'

interface TabBarProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  iconsOnly?: boolean
  appearance?: TabAppearance
  ref?: Ref<HTMLDivElement>
}

export function TabBar({ label, iconsOnly = false, appearance = 'workbench', children, className = '', onKeyDown, ref, ...props }: TabBarProps) {
  const root = useRef<HTMLDivElement>(null)
  const [density, setDensity] = useState<TabDensity>('full')
  useLayoutEffect(() => {
    if (iconsOnly || appearance !== 'workbench') return
    const strip = root.current
    if (!strip) return
    const measure = () => {
      const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[data-workbench-tab]'))
      const style = getComputedStyle(strip)
      let full = Math.max(0, tabs.length - 1) * (parseFloat(style.columnGap) || 0)
      let compact = full
      for (const tab of tabs) {
        const style = getComputedStyle(tab)
        const gap = parseFloat(style.columnGap) || 0
        const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
        const icon = tab.querySelector<HTMLElement>('[data-tab-icon]')?.getBoundingClientRect().width || 13
        const label = tab.querySelector<HTMLElement>('[data-tab-measure]')?.getBoundingClientRect().width || 0
        const badge = tab.querySelector<HTMLElement>('[data-tab-badge]')
        // Compact content stays mounted invisibly with its intrinsic width.
        const badgeWidth = badge?.getBoundingClientRect().width || 0
        const shell = tab.parentElement === strip ? 0 : (tab.parentElement?.getBoundingClientRect().width || 0) - tab.getBoundingClientRect().width
        compact += padding + icon + (badge ? gap + badgeWidth : 0) + Math.max(0, shell)
        full += padding + icon + gap + label + (badge ? gap + badgeWidth : 0) + Math.max(0, shell)
      }
      const available = strip.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
      if (available > 0) setDensity(tabDensity(available, { full, compact }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    strip.querySelectorAll('[data-tab-measure], [data-tab-badge]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  })
  return <div {...props} ref={(node) => {
    root.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }} role="tablist" aria-label={label} data-density={iconsOnly ? 'icons' : appearance !== 'workbench' ? 'full' : density} data-workbench-tabs
    style={{ ...props.style, scrollbarWidth: 'none' }}
    className={`group/tabs flex flex-nowrap min-w-0 shrink-0 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${appearance !== 'workbench' ? '[&>[data-resource-tab]]:flex-none [&>[data-resource-tab]]:w-max' : ''} ${tabBarAppearance[appearance]} ${className}`}
    onKeyDown={(event) => {
      onKeyDown?.(event)
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
      const index = tabs.indexOf(event.target as HTMLButtonElement)
      if (index < 0 || !tabs.length) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      tabs[next].focus()
      if (tabs[next].getAttribute('aria-selected') !== 'true') tabs[next].click()
      tabs[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }}>{children}</div>
}
