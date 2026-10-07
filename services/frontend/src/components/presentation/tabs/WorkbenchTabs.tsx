import type { ReactNode } from 'react'
import { TabBar } from './TabBar'
import { TabButton, type TabButtonProps } from './TabButton'

export interface WorkbenchTab<Id extends string> {
  id: Id
  label: string
  icon: TabButtonProps['icon']
  badge?: ReactNode
  disabled?: boolean
  title?: string
  controls?: string
  domId?: string
}

export function WorkbenchTabs<Id extends string>({ label, value, items, onChange, className }: {
  label: string; value: Id; items: readonly WorkbenchTab<Id>[]; onChange: (id: Id) => void; className?: string
}) {
  return <TabBar label={label} className={className}>
    {items.map((item) => <TabButton key={item.id} id={item.domId} label={item.label} icon={item.icon} badge={item.badge}
      selected={value === item.id} disabled={item.disabled} title={item.title} aria-controls={item.controls} onClick={() => onChange(item.id)}/>)}
  </TabBar>
}
