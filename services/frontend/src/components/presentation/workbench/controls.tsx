import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Icon, type IconName } from '../chrome/Icon'

const focus = 'focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-whx-accent focus-visible:!ring-offset-1 focus-visible:!ring-offset-whx-surface'
const control = `!box-border !min-h-8 !rounded-md !border !border-solid !text-whx-label !font-medium !leading-tight !shadow-none transition-colors motion-reduce:transition-none disabled:!cursor-default disabled:!opacity-40 ${focus}`
const tones = {
  neutral: '!border-whx-border !bg-whx-surface !text-whx-soft hover:!bg-whx-hover hover:!text-whx-text',
  primary: '!border-whx-accent !bg-whx-accent !text-[color:var(--theme-bg)] hover:!brightness-110',
  danger: '!border-whx-danger !bg-whx-surface !text-whx-danger hover:!bg-whx-hover',
  quiet: '!border-transparent !bg-transparent !text-whx-faint hover:!bg-whx-hover hover:!text-whx-text',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof tones; icon?: IconName }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ tone = 'neutral', icon, children, className = '', type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} className={`${control} !inline-flex !shrink-0 !items-center !justify-center !gap-2 !px-3 !py-1.5 ${tones[tone]} ${className}`}>
    {icon && <Icon name={icon} size={15}/>}<span>{children}</span>
  </button>
})

export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children'> & { label: string; icon: IconName; badge?: number; adornment?: ReactNode }>(function IconButton({ label, icon, badge, adornment, tone = 'quiet', className = '', type = 'button', ...props }, ref) {
  const layout = adornment ? '!inline-flex !h-8 !w-auto !min-w-8 !shrink-0 !items-center !justify-center !gap-1.5 !px-1.5' : '!grid !size-8 !shrink-0 !place-items-center !p-0'
  return <button {...props} ref={ref} type={type} aria-label={label} title={props.title || label} className={`${control} relative ${layout} ${tones[tone]} ${className}`}><Icon name={icon} size={16}/>{adornment}{badge !== undefined && <b className="absolute -right-1 -top-1 grid min-w-3.5 place-items-center rounded-full bg-whx-accent px-0.5 font-mono text-[10px] leading-[14px] text-[color:var(--theme-bg)]" aria-hidden="true">{badge > 99 ? '99+' : badge}</b>}</button>
})

export const fieldClass = `${control} !min-w-0 !border-whx-border !bg-whx-bg !px-3 !py-2 !text-whx-text placeholder:!text-whx-faint`
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`${fieldClass} ${className}`}/> }
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`${fieldClass} ${className}`}/> }
export function Field({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1.5 text-whx-label text-whx-text"><span className="font-medium">{label}</span>{children}{description && <small className="text-whx-caption leading-relaxed text-whx-faint">{description}</small>}</label>
}
