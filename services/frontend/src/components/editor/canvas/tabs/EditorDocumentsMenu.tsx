import type { WorkspaceFile } from '../../../../types'
import { ControlPopover } from '../../../presentation/workbench'
import { Icon } from '../../../presentation/chrome/Icon'
import { FileGlyph } from '../FileGlyph'

export function EditorDocumentsMenu({ documents, activePath, onSelect }: {
  documents: WorkspaceFile[]
  activePath?: string
  onSelect: (path: string) => void
}) {
  if (documents.length < 2) return null
  return <ControlPopover label="Ficheiros abertos" icon="list" alignment="end" density="compact"
    triggerLabel={`Selecionar ficheiro aberto; ${documents.length} ficheiros`}
    triggerAdornment={<span className="font-mono text-[calc(11px*var(--ui-font-scale))] text-whx-faint" aria-hidden="true">{documents.length}</span>}>
    {(close) => <div className="grid min-w-0 gap-0.5">
      {documents.map((file) => {
        const parts = file.path.split('/')
        const name = parts.at(-1) || file.path
        const parent = parts.slice(0, -1).join('/')
        const selected = file.path === activePath
        return <button key={file.path} type="button" data-popover-selected={selected ? '' : undefined}
          className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[4px] border-0 px-2 text-left transition-colors ${selected ? 'bg-whx-accent-soft text-whx-text' : 'bg-transparent text-whx-soft hover:bg-whx-hover hover:text-whx-text'}`}
          title={file.path} aria-current={selected ? 'page' : undefined}
          onClick={() => { onSelect(file.path); close() }}>
          <FileGlyph path={file.path} size={15}/>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <strong className="truncate text-[calc(12px*var(--ui-font-scale))] font-medium">{name}</strong>
            {parent && <small className="truncate font-mono text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{parent}</small>}
          </span>
          {selected && <Icon name="check" size={14}/>}
        </button>
      })}
    </div>}
  </ControlPopover>
}
