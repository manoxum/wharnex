import { WorkbenchTabs } from '../../presentation/tabs'
import type { ComposerDirective } from '../../../lib/chat/composer/composerDirectives'
export function ComposerAttachmentTabs({ attachments, selectedKey, onChange }: { attachments: ComposerDirective[]; selectedKey: string; onChange: (value: string) => void }) {
  return <WorkbenchTabs label="Caminhos anexados a este prompt" value={selectedKey} onChange={onChange} items={attachments.map((directive) => ({
    id: `${directive.kind}:${directive.kind === 'ref' ? directive.project : directive.path}`, label: directive.kind === 'ref' ? directive.project || directive.path : directive.path.split('/').filter(Boolean).pop() || directive.path,
    icon: directive.kind === 'ref' ? 'workspace' : 'folder', title: directive.kind === 'ref' ? directive.project : directive.path,
  }))}/>
}
