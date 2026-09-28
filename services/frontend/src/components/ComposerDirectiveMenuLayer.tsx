import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { DirectiveSuggestion } from '../lib/composerDirectives'
import { Icon } from './Icon'

const VIEWPORT_GUTTER = 12
const ANCHOR_GAP = 8
const MENU_MAX_WIDTH = 520

type MenuPosition = Pick<CSSProperties, 'left' | 'top' | 'width' | 'maxHeight' | 'visibility'>

/**
 * A viewport-level autocomplete surface anchored to the rich editor.
 *
 * The composer deliberately scrolls its text independently from the fixed
 * action bar. Keeping a suggestion list inside that scrolling element means
 * CSS overflow clips it regardless of z-index. This layer portals the list to
 * `document.body`, then follows the editor on resize and on any ancestor
 * scroll. React portals retain event bubbling to ChatPanel, while the fixed
 * coordinates escape every intermediate overflow and stacking context.
 */
export function ComposerDirectiveMenuLayer({ anchorRef, className, ariaLabel, children }: {
  anchorRef: RefObject<HTMLElement | null>
  className: string
  ariaLabel: string
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return

    const update = () => {
      if (!anchor.isConnected) {
        setPosition({ visibility: 'hidden' })
        return
      }
      const anchorRect = anchor.getBoundingClientRect()
      const measuredMenu = menu.getBoundingClientRect()
      const viewportWidth = window.visualViewport?.width || window.innerWidth
      const viewportHeight = window.visualViewport?.height || window.innerHeight
      const anchorInset = Math.min(12, Math.max(0, anchorRect.width / 4))
      const width = Math.max(0, Math.min(
        MENU_MAX_WIDTH,
        Math.max(anchorRect.width - anchorInset * 2, 240),
        viewportWidth - VIEWPORT_GUTTER * 2,
      ))
      const left = Math.min(
        Math.max(VIEWPORT_GUTTER, anchorRect.left + anchorInset),
        Math.max(VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER),
      )
      const spaceAbove = Math.max(0, anchorRect.top - ANCHOR_GAP - VIEWPORT_GUTTER)
      const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - ANCHOR_GAP - VIEWPORT_GUTTER)
      const preferAbove = spaceAbove >= Math.min(measuredMenu.height, 160) || spaceAbove >= spaceBelow
      const maxHeight = Math.max(80, preferAbove ? spaceAbove : spaceBelow)
      const visibleHeight = Math.min(measuredMenu.height || maxHeight, maxHeight)
      const top = preferAbove
        ? Math.max(VIEWPORT_GUTTER, anchorRect.top - ANCHOR_GAP - visibleHeight)
        : Math.min(viewportHeight - VIEWPORT_GUTTER - visibleHeight, anchorRect.bottom + ANCHOR_GAP)
      const next: MenuPosition = { left, top: Math.max(VIEWPORT_GUTTER, top), width, maxHeight, visibility: 'visible' }
      setPosition((current) => Object.entries(next).every(([key, value]) => current[key as keyof MenuPosition] === value) ? current : next)
    }

    update()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(anchor)
    observer?.observe(menu)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [anchorRef, children])

  return createPortal(
    <div
      ref={menuRef}
      className={`file-reference-menu directive-menu-layer ${className}`}
      role="listbox"
      aria-label={ariaLabel}
      data-chatgpt-overlay-blocker="true"
      style={position}
    >
      {children}
    </div>,
    document.body,
  )
}


export function ComposerDirectiveOptionRows({ suggestions, selectedIndex, onSelect, loading = false, hasMore = false, onLoadMore }: {
  suggestions: DirectiveSuggestion[]
  selectedIndex: number
  onSelect: (suggestion: DirectiveSuggestion) => void
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
}) {
  return <>
    {suggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={index === selectedIndex} key={`${suggestion.value}:${suggestion.label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(suggestion)}><Icon name={suggestion.sourceIcon || (suggestion.continues ? 'workspace' : 'file')} size={12}/><span>{suggestion.label}</span>{suggestion.detail && <em>{suggestion.detail}</em>}{suggestion.continues && suggestion.attached === false && <small className="unattached">ainda não anexado</small>}{index === selectedIndex && <kbd>Enter</kbd>}</button>)}
    {loading && <p className="composer-attachment-empty">A procurar tarefas…</p>}
    {!loading && hasMore && <button type="button" className="text-button" onMouseDown={(event) => event.preventDefault()} onClick={onLoadMore}>Carregar mais</button>}
  </>
}
