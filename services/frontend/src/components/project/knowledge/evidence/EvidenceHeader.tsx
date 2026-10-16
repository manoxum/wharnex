import type { EvolutionEvidence } from '../../../../types'
import { IconButton, PanelHeader } from '../../../presentation/workbench'

export function EvidenceHeader({ evidence, onClose }: { evidence?: EvolutionEvidence; onClose: () => void }) {
  const events = evidence ? `${evidence.total} eventos ${evidence.truncated ? 'limitados' : 'não tratados'}` : 'A carregar eventos…'
  const knowledge = evidence ? `${evidence.knowledge_total} conhecimento ${evidence.knowledge_truncated ? 'limitado' : 'elegível'}` : ''
  return <PanelHeader title="Dossiê de evolução" icon="activity" description={evidence ? <><span>{evidence.total} eventos </span><span>{evidence.truncated ? 'limitados' : 'não tratados'}</span>{knowledge ? ` · ${knowledge}` : ''}</> : events} actions={<IconButton icon="close" label="Fechar evidência" onClick={onClose}/>}/>
}
