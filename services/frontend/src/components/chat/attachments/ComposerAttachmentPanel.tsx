import { ComposerAttachmentTabs } from './ComposerAttachmentTabs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import type { AttachmentInspection, ContextInventoryEntry } from '../../../types'
import {
  attachRulesAreDefault,
  canonicalDirective,
  parseDirectives,
  removeDirective,
  renderAttachValue,
  renderRefValue,
  type AttachRules,
  type ComposerDirective,
} from '../../../lib/chat/composer/composerDirectives'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'

/**
 * Configures what an attached folder actually contributes.
 *
 * It is deliberately the project settings context panel, aimed at a different
 * root: the same automatic-pruning toggle, the same include/exclude pattern
 * lists, and the same inventory with a per-entry Include/Exclude control. An
 * attachment asks the same question the project already asks — what of this
 * tree is worth sending — and an operator should not have to learn a second
 * answer for it.
 *
 * It is a real modal, detached from the composer, rather than a panel squeezed
 * into the composer's own limited height: choosing what an attached folder
 * sends is its own decision, with an inventory that can run to hundreds of
 * rows, and it deserves the screen a modal gets rather than a 300px scroll box
 * wedged above the textarea.
 *
 * The selection lives in the marker in the prompt, not beside it. Editing here
 * rewrites that marker, so what this panel shows and what the request sends are
 * one string rather than two representations that can drift apart.
 */
export function ComposerAttachmentPanel({ sessionId, message, onMessage, onClose, initialPath, initialKind }: {
  sessionId: string
  message: string
  onMessage: (next: string) => void
  onClose: () => void
  /** Which attachment's tab to open first — set when Edit was clicked on a specific chip. */
  initialPath?: string
  initialKind?: 'attach' | 'ref'
}) {
  const attachments = useMemo(
    () => parseDirectives(message).filter((directive) => directive.kind === 'attach' || directive.kind === 'ref'),
    [message],
  )
  const initialKey = initialPath ? `${initialKind || 'attach'}:${initialPath}` : ''
  const [selectedKey, setSelectedKey] = useState(initialKey || (attachments[0] ? directiveKey(attachments[0]) : ''))
  const selected = attachments.find((item) => directiveKey(item) === selectedKey) || attachments[0]

  // Edit on a different chip while the modal is already open must jump to that
  // chip's own tab, not silently keep showing whichever one was open before.
  useEffect(() => {
    if (initialPath) setSelectedKey(`${initialKind || 'attach'}:${initialPath}`)
  }, [initialKind, initialPath])
  const [inspection, setInspection] = useState<AttachmentInspection>()
  const [inspectionError, setInspectionError] = useState('')
  const [loading, setLoading] = useState(false)
  const [includeText, setIncludeText] = useState('')
  const [excludeText, setExcludeText] = useState('')

  useEffect(() => {
    if (!selected) return
    if (selected.rules) {
      setIncludeText(selected.rules.include.join('\n'))
      setExcludeText(selected.rules.exclude.join('\n'))
    }
  }, [selected?.value])

  const inspect = useCallback(async (marker: string) => {
    setLoading(true); setInspectionError('')
    try {
      const directive = parseDirectives(marker)[0]
      const next = directive?.kind === 'ref'
        ? await api.referenceInspection(sessionId, marker)
        : await api.attachmentInspection(sessionId, marker)
      setInspection(next)
      if (directive?.kind === 'ref' && !directive.rules) {
        setIncludeText(next.include.join('\n'))
        setExcludeText(next.exclude.join('\n'))
      }
    } catch (error) {
      setInspection(undefined)
      setInspectionError(error instanceof Error ? error.message : 'Não foi possível ler este caminho')
    } finally { setLoading(false) }
  }, [sessionId])

  useEffect(() => {
    if (!selected) { setInspection(undefined); return }
    void inspect(canonicalDirective(selected))
  }, [inspect, selected?.value])

  // Rewriting by exact range rather than by search: two attachments can share a
  // path with different rules, and replacing the first match would edit the
  // wrong one.
  function writeRules(directive: ComposerDirective, rules: AttachRules) {
    const target = directive.kind === 'ref' ? (directive.path ? `${directive.project}/${directive.path}` : directive.project) : directive.path
    const value = directive.kind === 'ref' ? renderRefValue(target, rules) : renderAttachValue(target, rules)
    const marker = canonicalDirective({ kind: directive.kind, value })
    onMessage(message.slice(0, directive.start) + marker + message.slice(directive.end))
  }

  function applyPatternText() {
    if (!selected) return
    writeRules(selected, { ...effectiveRules(selected, inspection), include: patternLines(includeText), exclude: patternLines(excludeText) })
  }

  function applyEntrySelection(entry: ContextInventoryEntry, action: 'include' | 'exclude') {
    if (!selected) return
    const pattern = entry.kind === 'directory' ? `${entry.path.replace(/\/$/, '')}/**` : entry.path
    const current = effectiveRules(selected, inspection)
    const rules = action === 'exclude'
      ? { ...current, exclude: unique([...current.exclude, pattern]) }
      : { ...current, includeOverrides: unique([...current.includeOverrides, pattern]), exclude: current.exclude.filter((value) => value !== pattern) }
    writeRules(selected, rules)
  }

  function removeAttachment(directive: ComposerDirective) {
    onMessage(removeDirective(message, directive))
    if (attachments.length <= 1) onClose()
  }

  return <InternalWindow title="Conteúdo dos caminhos anexados" layerClassName="composer-attachment-backdrop" onClose={onClose}>
    <section className="composer-attachment-panel" role="dialog" aria-modal="false" aria-label="Conteúdo dos caminhos anexados">
      <header className="composer-attachment-heading">
        <div><span className="panel-kicker">Fontes de contexto</span><strong>Conteúdo enviado neste pedido</strong></div>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar painel de anexos"><Icon name="close" size={13}/></button>
      </header>

      {!attachments.length
        ? <p className="composer-attachment-empty">Escreva <code>@attach:</code> no prompt e escolha um ficheiro ou pasta para o anexar. Aqui pode depois decidir o que dele é enviado.</p>
        : <>
          <ComposerAttachmentTabs attachments={attachments} selectedKey={selected ? directiveKey(selected) : ''} onChange={setSelectedKey}/>

          {selected && <div className="composer-attachment-body">
            <div className="composer-attachment-root">
              <code title={selected.kind === 'ref' ? selected.project : selected.path}>{selected.kind === 'ref' ? `@ref ${selected.project}` : selected.path}</code>
              <button type="button" onClick={() => removeAttachment(selected)} aria-label={`Remover o anexo ${selected.path}`}><Icon name="trash" size={12}/> Remover</button>
            </div>

            {inspectionError
              ? <p className="composer-attachment-error" role="alert">{inspectionError}</p>
              : <p className="composer-attachment-summary" role="status">
                {loading ? 'A ler o caminho…' : inspection
                  ? <>{inspection.included_files} ficheiro(s) · {formatBytes(inspection.included_bytes)} · {inspection.excluded_items} item(ns) fora{inspection.truncated ? ' · LIMITE ATINGIDO: o anexo está incompleto' : ''}</>
                  : '—'}
              </p>}

            {/* A file has nothing to select inside it, so the selection controls
                appear only for a directory — showing empty pattern boxes for a
                single file would invite configuring something that has no parts. */}
            {inspection?.kind === 'directory' && <>
              <label className="settings-toggle">
                <input type="checkbox" checked={effectiveRules(selected, inspection).autoExclude} onChange={(event) => writeRules(selected, { ...effectiveRules(selected, inspection), autoExclude: event.target.checked })}/>
                <span><strong>Reconhecimento automático</strong><small>Exclui dependências, caches, builds, binários e metadados sem valor para a IA — a mesma regra do contexto do projeto.</small></span>
              </label>
              <div className="composer-attachment-patterns">
                <label><span>Incluir apenas <small>opcional</small></span><textarea value={includeText} onChange={(event) => setIncludeText(event.target.value)} onBlur={applyPatternText} placeholder={'openapi/**\ndocs/**'}/><small>Se vazio, tudo o que for elegível é considerado.</small></label>
                <label><span>Excluir do anexo</span><textarea value={excludeText} onChange={(event) => setExcludeText(event.target.value)} onBlur={applyPatternText} placeholder={'**/*.bak\nfixtures/**'}/><small>Um padrão por linha. Suporta <code>*</code>, <code>?</code> e <code>**</code>.</small></label>
              </div>
              {selected.kind === 'ref' && !selected.rules
                ? <p className="composer-attachment-note">A usar a configuração de contexto guardada neste projeto. Qualquer alteração abaixo cria uma seleção apenas para este pedido.</p>
                : !attachRulesAreDefault(effectiveRules(selected, inspection)) && <p className="composer-attachment-note">Esta seleção viaja dentro do próprio marcador no prompt, por isso acompanha o pedido e fica visível no histórico.</p>}
            </>}

            {inspection?.entries.length ? <div className="composer-attachment-inventory" role="table" aria-label={`Conteúdo de ${selected.path}`}>
              {inspection.entries.slice(0, 200).map((entry) => {
                const excluded = entry.status === 'excluded'
                const action = excluded ? 'include' : 'exclude'
                return <div className="composer-attachment-row" role="row" key={`${entry.status}:${entry.path}`}>
                  <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={12}/>
                  <span className="composer-attachment-path" title={entry.path}>{entry.path}</span>
                  <span className={`context-status ${entry.status}`}>{excluded ? 'FORA' : 'INCLUÍDO'}</span>
                  <small title={entry.reason}>{entry.reason || formatBytes(entry.size || 0)}</small>
                  {entry.configurable === false
                    ? <span className="context-locked" title="Esta decisão é protegida e não pode ser alterada"><Icon name="shield" size={12}/></span>
                    : <button type="button" className={`context-selection-button ${action}`} onClick={() => applyEntrySelection(entry, action)} title={`${action === 'include' ? 'Incluir' : 'Excluir'} ${entry.path}`}><Icon name={action === 'include' ? 'plus' : 'close'} size={11}/></button>}
                </div>
              })}
            </div> : null}
          </div>}
        </>}
    </section>
  </InternalWindow>
}

function directiveKey(directive: ComposerDirective) {
  return `${directive.kind}:${directive.kind === 'ref' ? directive.project : directive.path}`
}

function effectiveRules(directive: ComposerDirective, inspection?: AttachmentInspection): AttachRules {
  return directive.rules || {
    autoExclude: inspection?.auto_exclude ?? true,
    include: inspection?.include || [],
    includeOverrides: inspection?.include_overrides || [],
    exclude: inspection?.exclude || [],
  }
}

function patternLines(value: string) {
  return unique(value.split('\n').map((line) => line.trim()).filter(Boolean))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  return kib < 1024 ? `${kib.toFixed(1)} KiB` : `${(kib / 1024).toFixed(1)} MiB`
}
