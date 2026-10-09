import { TabBar, TabButton } from '../../presentation/tabs'
import type { InspectorTab } from '../../editor/inspector/Inspector'
import type { AttentionTarget, AttentionTone } from '../../../lib/attention/center/attentionCenter'

export function AgentSurfaceTabs({ singlePane, chatSelected, inspectorTab, conflict, onChat, onInspector, attention, tone, title }: {
  singlePane: boolean; chatSelected: boolean; inspectorTab: InspectorTab; conflict: boolean; onChat: () => void; onInspector: (tab: InspectorTab) => void
  attention: (target: AttentionTarget) => unknown[]; tone: (target: AttentionTarget) => AttentionTone | undefined; title: (target: AttentionTarget, fallback: string) => string
}) {
  return <TabBar iconsOnly label="Áreas do Agent" className="max-w-[240px]">
    {singlePane && <TabButton label="Chat" icon="send" selected={chatSelected} onClick={onChat}/>}
    <TabButton label="Ficheiros" icon="folder" selected={!chatSelected && inspectorTab === 'files'} onClick={() => onInspector('files')}/>
    {(['plan', 'terminal', 'chatgpt'] as const).map((target) => {
      const label = target === 'plan' ? 'Plano' : target === 'terminal' ? 'Execução' : conflict ? 'Conflito Engine' : 'Engine'
      const count = attention(target).length
      const severity = tone(target)
      const color = severity === 'danger' ? 'text-whx-danger!' : severity === 'success' ? 'text-whx-success!' : severity ? 'text-whx-warning!' : ''
      return <TabButton key={target} label={label} icon={target === 'chatgpt' ? 'agent' : target} selected={!chatSelected && inspectorTab === target}
        title={title(target, label)} aria-label={title(target, label)} badge={count > 0 ? count : undefined} className={color} onClick={() => onInspector(target)}/>
    })}
  </TabBar>
}
