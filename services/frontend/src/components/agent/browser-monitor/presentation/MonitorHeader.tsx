import { Button, PanelHeader, StatusBadge } from '../../../presentation/workbench'

export function MonitorHeader({ working, total, attention, available, policiesOpen, onPolicies, focused, onFocus }: {
  working: number; total: number; attention: boolean; available: boolean; policiesOpen: boolean
  onPolicies: () => void; focused: boolean; onFocus: () => void
}) {
  return <PanelHeader icon="monitor" title="Instâncias dos navegadores" description="Acompanhe conversas e operações no navegador real." actions={<>
    <span className="hidden min-[900px]:contents"><StatusBadge tone={working ? 'info' : 'neutral'}>{working} em trabalho</StatusBadge><StatusBadge>{total} instâncias</StatusBadge></span>
    <Button tone="quiet" icon="monitor" aria-pressed={focused} onClick={onFocus}>{focused ? 'Restaurar painéis' : 'Ampliar navegador'}</Button>
    <Button icon="settings" aria-expanded={policiesOpen} aria-controls="browser-monitor-policies" title={attention ? 'Políticas · há suspensões ativas' : 'Políticas do runtime'} disabled={!available} onClick={onPolicies}>Políticas{attention ? ' · atenção' : ''}</Button>
  </>}/>
}
