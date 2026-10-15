import type { CodexThread } from '../../../lib/codex'
import { Icon, type IconName } from '../../presentation/chrome/Icon'

const states: Record<CodexThread['status'], { label: string; icon: IconName; tone: string }> = {
  idle: { label: 'Pronto', icon: 'check', tone: 'text-whx-faint' },
  submitting: { label: 'A preparar', icon: 'refresh', tone: 'text-whx-accent' },
  running: { label: 'A trabalhar', icon: 'activity', tone: 'text-whx-accent' },
  ready: { label: 'Bundle recebido', icon: 'package', tone: 'text-whx-success' },
  attention: { label: 'Atenção necessária', icon: 'alert', tone: 'text-whx-warning' },
  waiting: { label: 'Aguarda resposta', icon: 'pause', tone: 'text-whx-warning' },
  completed: { label: 'Concluído', icon: 'check', tone: 'text-whx-success' },
}

export function CodexThreadStatus({ status }: { status: CodexThread['status'] }) {
  const state = states[status]
  return <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 text-[calc(10px*var(--ui-font-scale))] ${state.tone}`}><Icon name={state.icon} size={13}/>{state.label}</span>
}
