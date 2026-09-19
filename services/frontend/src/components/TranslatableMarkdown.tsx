import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { languageLabel } from '../lib/languageSettings'
import type { LanguageCode, LanguageSettings } from '../types'
import { MarkdownContent } from './MarkdownContent'

export function TranslatableMarkdown({ sessionId, markdown, compact = false }: {
  sessionId: string
  markdown: string
  compact?: boolean
}) {
  const [settings, setSettings] = useState<LanguageSettings>()
  const [target, setTarget] = useState<LanguageCode>()
  const [translated, setTranslated] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api.languageSettings().then((value) => {
      if (!alive) return
      setSettings(value)
      setTarget((current) => current && value.translation_languages.includes(current) ? current : value.translation_languages[0])
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os idiomas.') })
    return () => { alive = false }
  }, [])

  useEffect(() => { setTranslated(''); setError('') }, [markdown, sessionId, target])

  async function translate() {
    if (!target || loading) return
    setLoading(true); setError('')
    try {
      const result = await api.translateMarkdown(sessionId, target, markdown)
      setTranslated(result.markdown)
    } catch {
      setError('A tradução falhou. Tente novamente mais tarde.')
    } finally { setLoading(false) }
  }

  const languages = settings?.translation_languages || []
  return <div className="translatable-markdown">
    <div className="markdown-translation-toolbar" aria-label="Tradução do documento Markdown">
      <span>{translated ? `Tradução · ${target ? languageLabel(target) : ''}` : 'Documento original'}</span>
      <div>
        <select aria-label="Idioma da tradução" value={target || ''} disabled={!languages.length || loading} onChange={(event) => setTarget(event.target.value as LanguageCode)}>
          {languages.map((language) => <option key={language} value={language}>{languageLabel(language)}</option>)}
        </select>
        <button type="button" className="secondary-button" disabled={!target || loading} onClick={() => void translate()}>{loading ? 'A traduzir…' : 'Traduzir'}</button>
        {translated && <button type="button" className="text-button" onClick={() => setTranslated('')}>Ver original</button>}
      </div>
    </div>
    {error && <div className="markdown-translation-error" role="alert">{error}</div>}
    <MarkdownContent markdown={translated || markdown} compact={compact}/>
  </div>
}
