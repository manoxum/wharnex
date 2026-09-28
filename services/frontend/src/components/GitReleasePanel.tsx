import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitBranch, GitOverview } from '../types'
import { confirmDialog } from '../lib/appDialog'
import { Icon } from './Icon'
import { InternalWindow } from './InternalWindow'
import { GitReleaseRichText } from './GitReleaseRichText'
import { releaseTagName } from './GitReleaseTag'

export type GitReleaseDraftInput = { branch: string; tag_suffix: string; title: string; body: string }
export type GitReleasePublishResult = { ok: boolean; error?: string }

export function GitReleasePanel({ tags, branches, projectVersion, disabled, onCopyTag, onGenerateReleaseNotes, onCreateRelease }: {
  tags: GitOverview['tags']; branches: GitBranch[]; projectVersion: string; disabled: boolean
  onCopyTag: (tag: string) => void; onGenerateReleaseNotes: (branch: string) => Promise<string>
  onCreateRelease: (input: GitReleaseDraftInput) => Promise<GitReleasePublishResult>
}) {
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState('')
  const [tagSuffix, setTagSuffix] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<'manual' | 'gpt'>('manual')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const finalTag = releaseTagName(projectVersion, tagSuffix)
  const canPublish = Boolean(branch && finalTag && body.trim())

  async function generate() {
    if (!branch) return
    setGenerating(true); setError('')
    try { setBody(await onGenerateReleaseNotes(branch)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setGenerating(false) }
  }

  async function publish() {
    setError('')
    const confirmed = await confirmDialog({ title: `Publicar ${finalTag}?`, message: `Será criada a tag ${finalTag} no commit de ${branch} e publicada no remoto dessa branch, sem force.`, tone: 'warning', confirmLabel: 'Criar tag e release' })
    if (!confirmed) return
    try {
      const result = await onCreateRelease({ branch, tag_suffix: tagSuffix.trim(), title: title.trim(), body: body.trim() })
      if (!result.ok) { setError(result.error || 'Não foi possível criar a tag e a release.'); return }
      setTagSuffix(''); setTitle(''); setBody(''); setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <>
    <div className="git-release-library">
      <div className="git-release-library-heading">
        <div className="git-release-library-title"><span className="git-release-library-icon"><Icon name="package" size={15}/></span><div><span>Publicações</span><strong>Tags e releases</strong><small>Histórico local das tags criadas para este projeto.</small></div></div>
        <div className="git-release-library-actions">{projectVersion && <span className="git-release-version-chip" title="Versão atual do projeto"><Icon name="package" size={11}/>{projectVersion}</span>}<button type="button" className="git-action primary git-release-new" disabled={disabled} onClick={() => setOpen(true)}><Icon name="plus" size={12}/>Nova release</button></div>
      </div>
      {tags.length === 0 ? <div className="git-release-empty"><span><Icon name="package" size={16}/></span><div><strong>Ainda não existem tags</strong><small>Cria uma release para publicar a versão atual e ela aparecerá aqui.</small></div></div> : <ul className="git-release-list">{tags.map((tag) => <li key={tag.name}><span className="git-release-list-icon"><Icon name="package" size={13}/></span><span className="git-release-list-copy"><strong>{tag.name}</strong><small>{tag.created_at ? new Date(tag.created_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Tag local'} · {tag.commit_sha.slice(0, 8)}</small></span><span className="git-release-list-state"><Icon name="check" size={10}/>Tag</span><button type="button" className="git-inline-copy git-release-copy" aria-label={`Copiar tag ${tag.name}`} title="Copiar tag" onClick={() => onCopyTag(tag.name)}><Icon name="copy" size={11}/></button></li>)}</ul>}
    </div>
    {open && createPortal(<InternalWindow title="Criar nova release" onClose={() => setOpen(false)} layerClassName="git-diff-backdrop git-release-backdrop">
      <div className="git-release-modal" role="dialog" aria-modal="false" aria-label="Criar nova release">
        <header className="git-release-modal-header"><div><span className="panel-kicker">Publicação</span><strong>Preparar uma nova release</strong><small>A tag nasce da versão do projeto e do commit da branch remota selecionada.</small></div><button type="button" className="agent-drawer-icon" onClick={() => setOpen(false)} aria-label="Fechar criação de release"><Icon name="close" size={13}/></button></header>
        <div className="git-release-modal-body"><div className="git-release-panel">
          <div className="git-release-hero"><span className="git-release-hero-icon"><Icon name="package" size={17}/></span><div className="git-release-hero-copy"><span>Release</span><strong>{finalTag || 'Versão do projeto indisponível'}</strong><small>Seleciona uma branch remota, revê a identificação e prepara as notas.</small></div><div className={`git-release-readiness ${canPublish ? 'ready' : 'pending'}`}><Icon name={canPublish ? 'check' : 'info'} size={12}/><span>{canPublish ? 'Pronta para publicar' : 'Preenche os campos obrigatórios'}</span></div></div>
          <div className="git-release-fields">
            <div className="git-release-card"><div className="git-release-card-heading"><span className="git-release-card-icon"><Icon name="git" size={14}/></span><div><span>Destino</span><strong>Branch remota</strong></div></div><div className="git-release-grid"><label><span>Branch remota *</span><select aria-label="Branch remota da release" value={branch} disabled={disabled} onChange={(event) => { setBranch(event.target.value); setBody('') }}><option value="">Selecionar branch remota…</option>{branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><p className="git-hint">O remoto é deduzido da própria branch; não é necessário escolhê-lo separadamente.</p></div></div>
            <div className="git-release-card"><div className="git-release-card-heading"><span className="git-release-card-icon"><Icon name="package" size={14}/></span><div><span>Identidade</span><strong>Versão e título</strong></div></div><div className="git-release-grid"><label><span>Versão base</span><span className={`git-release-version-base ${projectVersion ? '' : 'missing'}`}>{projectVersion || 'VERSION indisponível'}</span></label><label><span>Tag (opcional)</span><input aria-label="Tag opcional da release" value={tagSuffix} disabled={disabled} onChange={(event) => setTagSuffix(event.target.value)} placeholder="ex.: rc1 ou beta"/></label><div className="git-release-tag-preview"><span>Tag final</span><code>{finalTag || '—'}</code></div><label><span>Título</span><input aria-label="Título da release" value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} placeholder="Opcional · usa a tag final se vazio"/></label></div></div>
          </div>
          <div className="git-release-notes-card"><div className="git-release-notes-heading"><div><span>Conteúdo</span><strong>Notas da release</strong><small>Escreve manualmente ou deixa o GPT preparar um primeiro rascunho.</small></div><div className="git-release-mode" role="group" aria-label="Modo das notas de release"><button type="button" className={mode === 'manual' ? 'active' : ''} disabled={disabled} onClick={() => { setMode('manual'); setError(''); setBody('') }}><Icon name="edit" size={12}/>Escrever</button><button type="button" className={mode === 'gpt' ? 'active' : ''} disabled={disabled} onClick={() => { setMode('gpt'); setError(''); setBody('') }}><Icon name="agent" size={12}/>Gerar com GPT</button></div></div>
            {mode === 'manual' ? <GitReleaseRichText value={body} disabled={disabled} onChange={setBody}/> : <div className="git-release-gpt"><div className="git-release-gpt-action"><button type="button" className="git-action" disabled={disabled || generating || !branch} onClick={() => void generate()}><Icon name="agent" size={12}/>{generating ? 'A gerar…' : 'Gerar notas da branch'}</button><span>Usa apenas os commits da branch remota selecionada.</span></div><textarea aria-label="Notas de release geradas pelo GPT" value={body} disabled={disabled || generating} onChange={(event) => setBody(event.target.value)} placeholder={branch ? 'O GPT irá resumir os commits recentes desta branch.' : 'Seleciona primeiro uma branch remota.'}/><p className="git-hint">O GPT gera apenas as notas; podes revê-las antes de publicar.</p></div>}
          </div>
          {error && <p className="git-notice error-card" role="alert">{error}</p>}
          <div className="git-release-footer"><div className="git-release-safety-note"><span><Icon name="shield" size={13}/></span><div><strong>Publicação segura</strong><small>A tag é criada no commit remoto escolhido e enviada sem force.</small></div></div><button type="button" className="git-action primary git-release-publish" disabled={disabled || generating || !canPublish} onClick={() => void publish()}><Icon name="arrow-up" size={13}/>Criar tag e release</button></div>
        </div></div>
      </div>
    </InternalWindow>, document.body)}
  </>
}
