import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react'
import { Icon, type IconName } from '../chrome/Icon'
import { tabButtonAppearance, type TabAppearance } from './tabAppearance'

export interface TabButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  ref?: Ref<HTMLButtonElement>
  icon: IconName | ReactElement
  badge?: ReactNode
  trailingIcon?: IconName
  selected: boolean
  appearance?: TabAppearance
}

// Labels and badges stay mounted: the strip measures intrinsic text even when compact.
export function TabButton({ label, icon, badge, trailingIcon, selected, appearance = 'workbench', className = '', ...props }: TabButtonProps) {
  return <button {...props} type="button" role="tab" aria-selected={selected} aria-label={props['aria-label'] || label}
    title={props.title || label} tabIndex={selected && !props.disabled ? 0 : -1} data-workbench-tab
    className={`group/tab relative inline-flex overflow-hidden items-center whitespace-nowrap bg-transparent font-sans! leading-none! ${appearance === 'project' ? '' : 'transition-colors'} focus-visible:outline-2! focus-visible:outline-offset-[-3px]! disabled:cursor-not-allowed disabled:opacity-50 ${tabButtonAppearance[appearance]} ${className}`}>
    {appearance !== 'conversation' && <span data-tab-icon className="inline-flex shrink-0" aria-hidden="true">{typeof icon === 'string' ? <Icon name={icon} size={13}/> : icon}</span>}
    <span data-tab-label data-tab-measure className={`${appearance === 'workbench' || appearance === 'project' ? 'w-max' : appearance === 'document' ? 'min-w-0 max-w-[150px] truncate text-left' : 'min-w-0 flex-1 truncate text-left'} group-data-[density=compact]/tabs:absolute group-data-[density=compact]/tabs:invisible group-data-[density=icons]/tabs:absolute group-data-[density=icons]/tabs:invisible`}>{label}</span>
    {appearance === 'conversation' && <span data-tab-icon className="inline-flex shrink-0" aria-hidden="true">{typeof icon === 'string' ? <Icon name={icon} size={13}/> : icon}</span>}
    {trailingIcon && <Icon name={trailingIcon} size={11}/>}
    {badge !== undefined && badge !== null && badge !== false && <span data-tab-badge className={`${appearance === 'document' ? 'inline-flex shrink-0 items-center gap-1.5' : 'inline-grid h-[17px] min-w-[17px] shrink-0 place-items-center rounded-full bg-whx-muted px-[5px] font-mono text-xs font-bold text-whx-faint group-aria-selected/tab:bg-[color-mix(in_srgb,var(--theme-tab-active)_15%,var(--theme-surface))] group-aria-selected/tab:text-whx-text group-data-[density=icons]/tabs:absolute group-data-[density=icons]/tabs:invisible'}`}>{badge}</span>}
  </button>
}
