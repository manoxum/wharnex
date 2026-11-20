import { useState } from 'react'
import { EditorDocumentsMenu } from '../../../src/components/editor/canvas/tabs'
import { WorkspaceNavigation } from '../../../src/components/workspace/shell/navigation'
import { LanguageSettingsPanel } from '../../../src/components/project/settings/LanguageSettingsPanel'
import { useTranslation } from '../../../src/lib/workspace/localization'
const files = Array.from({ length: 70 }, (_, index) => ({ path: index === 0 ? 'src/Guardar.tsx' : `services/frontend/src/features/feature-${index}/LongDocumentName${index}.tsx`, content: '', draft: index === 3 ? 'modified' : '', sha256: '', size: 0 }))
const noop = () => {}
export function DocumentsFixture() {
  const t = useTranslation()
  const [active, setActive] = useState(files[30].path)
  const [settings, showSettings] = useState(false)
  const [drawer, setDrawer] = useState<'project' | ''>('project')
  return <main className="flex h-screen bg-whx-bg text-whx-text">
    <WorkspaceNavigation side="left" tools={['project', 'git']} pinnedTools={['terminal']} drawer={drawer} terminalOpen={false} pendingCommitCount={0} savedChatCount={0} onToggle={() => setDrawer(drawer ? '' : 'project')} onToggleTerminal={noop}/>
    {drawer && <aside data-testid="tool-pane" className="w-56 rounded-lg border border-whx-border-soft bg-whx-side p-3">{t('Explorador do projeto')}</aside>}
    <section data-testid="content" className="flex min-w-0 flex-1 flex-col bg-whx-bg">
      <header className="flex h-9 shrink-0 justify-end gap-2 border-b border-whx-border-soft bg-whx-workspace px-2"><button onClick={() => showSettings(!settings)}>{t('Definições')}</button><EditorDocumentsMenu documents={files} activePath={active} onSelect={setActive}/></header>
      <output data-testid="selected-file" className="p-4 font-mono text-whx-caption">{active}</output>
      {settings && <div className="min-h-0 overflow-y-auto"><LanguageSettingsPanel onError={noop}/></div>}
    </section>
    <WorkspaceNavigation side="right" tools={['docker', 'knowledge']} pinnedTools={[]} drawer="docker" terminalOpen={false} pendingCommitCount={0} savedChatCount={0} onToggle={noop} onToggleTerminal={noop}/>
  </main>
}
