import { useState } from 'react'
import { Icon } from '../../presentation/chrome/Icon'
import { BundleUsagePopup } from './BundleUsagePopup'
import { useBundleQuota } from './useBundleQuota'

export function BundleConsumption({ refreshKey }: { refreshKey: string }) {
  const { quota, error, refresh } = useBundleQuota(refreshKey)
  const [open, setOpen] = useState(false)
  if (!quota) return error ? <span className="ml-auto" role="status">Bundles indisponíveis</span> : null
  const remaining = quota.limit > 0 ? Math.max(0, Math.round((1 - Math.min(1, quota.sent / quota.limit)) * 100)) : 100
  const label = `Bundles nas últimas ${quota.window_hours} horas`
  const detail = `Estimativa local Wharnex: ${quota.sent}/${quota.limit} enviados; ${quota.received} recebidos; ${remaining}% restante. Abrir consumo por tipo de tarefa.${error ? ` ${error}` : ''}`
  return <>
    <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} title={detail}
      onClick={() => { setOpen(true); void refresh() }}
      className={`ml-auto grid h-full min-w-[220px] cursor-pointer grid-cols-[auto_minmax(62px,96px)_auto] items-center gap-[7px] border-0 bg-transparent p-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-(--theme-accent) max-[820px]:min-w-[154px] max-[820px]:grid-cols-[auto_minmax(50px,1fr)_auto] ${quota.warning ? 'text-(--theme-danger)' : 'text-(--theme-text-muted)'}`}>
      <span className="inline-flex items-center gap-1"><Icon name="send" size={13}/><b className="font-[family-name:var(--mono-font-family)] text-[7px] leading-none font-extrabold text-(--theme-text)">{quota.window_hours}h</b><small className="font-[family-name:var(--mono-font-family)] text-[7px] leading-none font-[650] max-[820px]:hidden">↑{quota.sent}/{quota.limit} ↓{quota.received}</small></span>
      <i className="block h-1 min-w-[62px] overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-border)_72%,transparent)]" aria-hidden="true"><i className={`block h-full rounded-[inherit] transition-[width] duration-200 ${quota.warning ? 'bg-current' : 'bg-(--theme-accent)'}`} style={{ width: `${remaining}%` }}/></i>
      <strong className={`min-w-[29px] text-right font-[family-name:var(--mono-font-family)] text-[7px] leading-none font-extrabold ${quota.warning ? 'text-current' : 'text-(--theme-text)'}`}>{remaining}%</strong>
    </button>
    {open && <BundleUsagePopup quota={quota} error={error} onRefresh={() => { void refresh() }} onClose={() => setOpen(false)}/>}
  </>
}
