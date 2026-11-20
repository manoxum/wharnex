import { translate as uiText, formatMessage } from '../../../lib/workspace/localization'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { languageLabel } from '../../../lib/project/connections/languageSettings'
import type { LanguageCode, LanguageSettings } from '../../../types'
import { Button, Select } from '../workbench'
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
  const [startedAt, setStartedAt] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [completedSeconds, setCompletedSeconds] = useState<number>()

  useEffect(() => {
    let alive = true
    api.languageSettings().then((value) => {
      if (!alive) return
      setSettings(value)
      setTarget((current) => current && value.translation_languages.includes(current) ? current : value.translation_languages[0])
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : uiText('Não foi possível carregar os idiomas.')) })
    return () => { alive = false }
  }, [])

  useEffect(() => { setTranslated(''); setError(''); setCompletedSeconds(undefined) }, [markdown, sessionId, target])

  useEffect(() => {
    if (!loading || !startedAt) return
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1_000)
    return () => window.clearInterval(timer)
  }, [loading, startedAt])

  async function translate() {
    if (!target || loading) return
    const start = Date.now()
    setStartedAt(start); setElapsedSeconds(0); setCompletedSeconds(undefined)
    setLoading(true); setError('')
    try {
      const result = await api.translateMarkdown(sessionId, target, markdown)
      setTranslated(result.markdown)
      setCompletedSeconds(Math.max(1, Math.ceil((Date.now() - start) / 1000)))
    } catch {
      setError(uiText('A tradução falhou. Tente novamente mais tarde.'))
    } finally { setLoading(false) }
  }

  const languages = settings?.translation_languages || []
  return <div className="translatable-markdown min-h-0 min-w-0">
    <div className="markdown-translation-toolbar mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-whx-border-soft pb-2 text-whx-caption text-whx-faint" aria-label={uiText("Tradução do documento Markdown")}>
      <span>{translated ? formatMessage('Tradução · {language}', { language: target ? languageLabel(target) : '' }) : uiText("Documento original")}</span>
      <div className="flex flex-wrap items-center gap-1">
        <Select className="!max-w-40 !py-1 !text-whx-caption" aria-label={uiText("Idioma da tradução")} value={target || ''} disabled={!languages.length || loading} onChange={(event) => setTarget(event.target.value as LanguageCode)}>
          {languages.map((language) => <option key={language} value={language}>{languageLabel(language)}</option>)}
        </Select>
        <Button tone="quiet" disabled={!target || loading} onClick={() => void translate()}>{loading ? uiText("A traduzir…") : uiText("Traduzir")}</Button>
        {translated && <Button tone="quiet" onClick={() => setTranslated('')}>{uiText("Ver original")}</Button>}
      </div>
    </div>
    {loading && <div role="status" className="mb-2 text-whx-caption text-whx-faint">{uiText("Tradução solicitada ao Translator · a aguardar o resultado há")}{' '}{elapsedSeconds}s</div>}
    {translated && completedSeconds !== undefined && !loading && <div role="status" className="mb-2 text-whx-caption text-whx-faint">{uiText("Tradução concluída em")}{' '}{completedSeconds}s · {target ? languageLabel(target) : ''}</div>}
    {error && <div className="markdown-translation-error mb-2 rounded border border-whx-danger/40 bg-whx-danger/10 px-3 py-2 text-whx-label leading-relaxed text-whx-danger" role="alert">{error}</div>}
    <MarkdownContent markdown={translated || markdown} compact={compact}/>
  </div>
}
