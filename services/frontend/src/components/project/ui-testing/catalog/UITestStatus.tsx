import { Icon, type IconName } from '../../../presentation/chrome/Icon'
import { testStatus } from './testStatus'

const icons: Record<string, IconName> = { passed: 'check', failed: 'close', blocked: 'alert', running: 'play', queued: 'list', waiting: 'pause', skipped: 'minus', ready: 'flask' }
export function UITestStatus({ value }: { value: string }) {
  const { label, tone } = testStatus(value)
  return <span className={`inline-flex shrink-0 items-center gap-1.5 text-whx-label font-medium ${tone}`}>
    <Icon name={icons[value] || 'info'} size={13}/>{label}
  </span>
}
