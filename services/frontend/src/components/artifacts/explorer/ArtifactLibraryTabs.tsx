import { WorkbenchTabs } from '../../presentation/tabs'
export function ArtifactLibraryTabs({ mode, onChange }: { mode: 'library' | 'bundles'; onChange: (mode: 'library' | 'bundles') => void }) {
  return <WorkbenchTabs label="Níveis da biblioteca" value={mode} onChange={onChange} items={[
    { id: 'library', label: 'Biblioteca', icon: 'file' }, { id: 'bundles', label: 'Bundles', icon: 'package' },
  ]}/>
}
