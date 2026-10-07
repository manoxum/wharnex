import { testStatus } from './testStatus'

export function UITestStatus({ value }: { value: string }) {
  const { label, tone } = testStatus(value)
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-sm font-medium ${tone}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full bg-current ${value === 'running' ? 'motion-safe:animate-pulse' : ''}`}/>{label}
  </span>
}
