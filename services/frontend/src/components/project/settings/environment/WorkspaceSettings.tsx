import { Button, Field, Input, StatusBadge } from '../../../presentation/workbench'
import { SettingsPage } from '../presentation'

export function WorkspaceSettings({ directory, onDirectory, canBrowse, onBrowse, onSave, onClear }: {
  directory: string; onDirectory: (directory: string) => void; canBrowse: boolean
  onBrowse: () => void; onSave: () => void; onClear: () => void
}) {
  return <SettingsPage title="Workspace padrão" description="Define a pasta inicial usada pelos seletores de abrir, criar e clonar projetos na página inicial.">
    <StatusBadge icon="folder">{directory ? 'Pasta configurada' : 'Seleção automática'}</StatusBadge>
    <Field label="Pasta de trabalho" description="O caminho fica apenas neste dispositivo e pode ser alterado a qualquer momento."><div className="flex flex-wrap gap-3"><Input aria-label="Workspace padrão" value={directory} onChange={(event) => onDirectory(event.target.value)} placeholder="/home/utilizador/workspace" spellCheck={false} className="!min-w-0 !flex-1"/><Button icon="folder" disabled={!canBrowse} onClick={onBrowse}>Procurar</Button></div></Field>
    <div className="flex flex-wrap gap-3"><Button icon="save" tone="primary" onClick={onSave}>Guardar workspace</Button>{directory && <Button onClick={onClear}>Usar seleção automática</Button>}</div>
    <p className="!m-0 border-t border-whx-border-soft pt-4 !text-whx-caption !leading-relaxed !text-whx-faint">Ao abrir uma pasta, o seletor começa neste workspace. Criar projeto também usa este destino por padrão; o repositório Git local continua a ser inicializado pelo fluxo normal de criação.</p>
  </SettingsPage>
}
