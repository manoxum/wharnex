import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
import { useState } from 'react'
import type { WorkspaceFile } from '../../../../types'
import { ControlPopover } from '../../../presentation/workbench'
import { DocumentsList } from './DocumentsList'

export function EditorDocumentsMenu({ documents, activePath, onSelect }: {
  documents: (WorkspaceFile & { draft?: string })[]
  activePath?: string
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (documents.length < 2) return null
  return <ControlPopover label={uiText("Ficheiros abertos")} icon="list" alignment="end" density="compact" layout="document-list" open={open} onOpenChange={setOpen}
    triggerLabel={formatMessage('Selecionar ficheiro aberto; {count} ficheiros', { count: documents.length })}
    triggerAdornment={<span className="font-mono text-whx-caption text-whx-faint" aria-hidden="true">{documents.length}</span>}>
    {(close) => <DocumentsList documents={documents} activePath={activePath} onSelect={(path) => { onSelect(path); close() }}/>}
  </ControlPopover>
}
