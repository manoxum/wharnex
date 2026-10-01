import { useEffect, useMemo, useRef, useState } from 'react'
import { api, APIError } from '../../../lib/transport/http/api'
import { rankWorkspaceFiles } from '../../../lib/editor/runtime/editorSearch'
import type { FileEntry, WorkspaceSearchMatch } from '../../../types'
import { FileGlyph } from './FileGlyph'
import { Icon } from '../../presentation/chrome/Icon'

export type EditorSearchMode = 'files' | 'project'

type Props = {
  mode: EditorSearchMode
  sessionId: string
  files: FileEntry[]
  onClose: () => void
  onOpen: (path: string, line?: number, column?: number) => void
}

export function EditorSearchPalette({ mode, sessionId, files, onClose, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [fuzzy, setFuzzy] = useState(false)
  const [matches, setMatches] = useState<WorkspaceSearchMatch[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const requestNonce = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileMatches = useMemo(() => rankWorkspaceFiles(files, query), [files, query])
  const resultCount = mode === 'files' ? fileMatches.length : matches.length

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    setQuery('')
    setMatches([])
    setError('')
    setActiveIndex(0)
  }, [mode])

  useEffect(() => {
    if (mode !== 'project') return
    const trimmed = query.trim()
    const nonce = ++requestNonce.current
    if (!trimmed) {
      setMatches([])
      setTruncated(false)
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      void api.searchWorkspace(sessionId, {
        query: trimmed,
        case_sensitive: caseSensitive,
        regex,
        whole_word: wholeWord,
        fuzzy,
        limit: 300,
      }).then((result) => {
        if (requestNonce.current !== nonce) return
        setMatches(result.matches || [])
        setTruncated(Boolean(result.truncated))
        setError('')
        setActiveIndex(0)
      }).catch((cause) => {
        if (requestNonce.current !== nonce) return
        setMatches([])
        setTruncated(false)
        setError(messageOf(cause))
      }).finally(() => {
        if (requestNonce.current === nonce) setLoading(false)
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [caseSensitive, fuzzy, mode, query, regex, sessionId, wholeWord])

  function openActive() {
    if (mode === 'files') {
      const file = fileMatches[activeIndex]
      if (file) { onOpen(file.path); onClose() }
      return
    }
    const match = matches[activeIndex]
    if (match) { onOpen(match.path, match.line, match.column); onClose() }
  }

  return <div className="editor-search-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className={`editor-search-palette mode-${mode}`} role="dialog" aria-modal="true" aria-label={mode === 'files' ? 'Localizar ficheiro' : 'Pesquisar em todo o projeto'} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(Math.max(0, resultCount - 1), index + 1)); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); return }
      if (event.key === 'Enter') { event.preventDefault(); openActive() }
    }}>
      <header>
        <div className="editor-search-heading"><span className="panel-kicker">{mode === 'files' ? 'Navegação rápida' : 'Pesquisa global'}</span><strong>{mode === 'files' ? 'Localizar ficheiro' : 'Pesquisar no projeto'}</strong><small>{mode === 'files' ? 'Abra rapidamente qualquer ficheiro pelo nome ou caminho.' : 'Encontre texto no workspace inteiro e abra a correspondência exata.'}</small></div>
        <div className="editor-search-header-actions"><kbd>{mode === 'files' ? 'Shift Shift' : 'Ctrl ⇧ F'}</kbd><button type="button" onClick={onClose} aria-label="Fechar pesquisa" title="Fechar"><Icon name="close" size={13}/></button></div>
      </header>
      <label className="editor-search-input">
        <Icon name="search" size={16}/>
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'files' ? 'Nome ou caminho do ficheiro…' : 'Texto, símbolo ou expressão…'} aria-label={mode === 'files' ? 'Nome do ficheiro' : 'Texto a pesquisar'}/>
        {loading ? <span className="editor-search-spinner" aria-label="A pesquisar"/> : query ? <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><Icon name="close" size={12}/></button> : null}
      </label>
      {mode === 'project' && <div className="editor-search-options" aria-label="Opções de pesquisa">
        <button type="button" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((value) => !value)} title="Distinguir maiúsculas de minúsculas"><b>Aa</b> Maiúsculas</button>
        <button type="button" aria-pressed={wholeWord} onClick={() => setWholeWord((value) => !value)} title="Corresponder apenas à palavra inteira"><b>Ab</b> Palavra inteira</button>
        <button type="button" aria-pressed={regex} onClick={() => { setRegex((value) => !value); setFuzzy(false) }} title="Interpretar caracteres especiais como expressão regular"><b>.*</b> Regex</button>
        <button type="button" aria-pressed={fuzzy} onClick={() => { setFuzzy((value) => !value); setRegex(false); setWholeWord(false) }} title="Aceitar pequenas diferenças de escrita"><b>≈</b> Aproximada</button>
      </div>}
      <div className="editor-search-results" role="listbox" aria-label="Resultados">
        {mode === 'files' ? fileMatches.map((file, index) => <button type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'active' : ''} key={file.path} onMouseEnter={() => setActiveIndex(index)} onClick={() => { onOpen(file.path); onClose() }}>
          <FileGlyph path={file.path} size={14}/><span><strong>{file.name}</strong><small>{file.path}</small></span>
        </button>) : matches.map((match, index) => <button type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'active' : ''} key={`${match.path}:${match.line}:${match.column}:${index}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => { onOpen(match.path, match.line, match.column); onClose() }}>
          <FileGlyph path={match.path} size={14}/><span><strong>{match.path}<em>{match.line}:{match.column}</em></strong><small>{match.preview || 'Linha sem pré-visualização'}</small></span>
        </button>)}
        {!loading && query && !error && resultCount === 0 ? <div className="editor-search-empty"><Icon name="search" size={18}/><strong>Sem resultados</strong><span>Tente outro termo ou altere as opções de correspondência.</span></div> : null}
        {!query && mode === 'project' && <div className="editor-search-empty compact"><span>Caracteres especiais são literais por defeito. Ative Regex apenas quando quiser uma expressão.</span></div>}
        {error && <div className="editor-search-error"><Icon name="alert" size={14}/><span>{error}</span></div>}
      </div>
      <footer><span>{resultCount} {resultCount === 1 ? 'resultado' : 'resultados'}{truncated ? ' · primeiros 300' : ''}</span><span><kbd>↑</kbd><kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar</span></footer>
    </section>
  </div>
}

function messageOf(error: unknown) {
  if (error instanceof APIError || error instanceof Error) return error.message
  return 'Não foi possível pesquisar o projeto.'
}
