import { WorkbenchTabs } from '../../presentation/tabs'
type Source = 'events' | 'knowledge' | 'external'
export function EvolutionEvidenceTabs({ value, onChange, events, knowledge, files }: { value: Source; onChange: (source: Source) => void; events: number; knowledge: number; files: number }) {
  return <WorkbenchTabs label="Modalidade de auto-evolução" value={value} onChange={onChange} items={[
    { id: 'events', label: 'Eventos', icon: 'activity', badge: events }, { id: 'knowledge', label: 'Conhecimento', icon: 'knowledge', badge: knowledge },
    { id: 'external', label: 'Logs externos', icon: 'file', badge: files },
  ]}/>
}
