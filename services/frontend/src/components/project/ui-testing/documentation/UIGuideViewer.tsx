import { useEffect, useState } from 'react'
import type { UIGuide } from '../../../../types'
import { desktopBridge } from '../../../../lib/desktop/bridge/desktop'
import { uiTestingApi } from '../../../../lib/ui-testing/uiTestingApi'
import { resolveGuideImages } from '../../../../lib/ui-testing/uiTestingManual'
import { MarkdownContent } from '../../../presentation/content/MarkdownContent'
import { Icon } from '../../../presentation/chrome/Icon'
import { WorkbenchTabs } from '../../../presentation/tabs'
import { uiSecondaryButtonClass } from '../uiTestingStyles'

export type GuideFormat = 'html' | 'pdf' | 'md'

const FORMAT_FILE: Record<GuideFormat, string> = { html: 'guide.html', pdf: 'guide.pdf', md: 'guide.md' }
const FORMAT_LABEL: Record<GuideFormat, string> = { html: 'HTML interativo', pdf: 'PDF', md: 'Markdown' }

function defaultGuideFormat(guide: UIGuide): GuideFormat {
  return guide.html_ready ? 'html' : guide.pdf_ready ? 'pdf' : 'md'
}

function available(guide: UIGuide, format: GuideFormat) {
  return format === 'html' ? Boolean(guide.html_ready) : format === 'pdf' ? guide.pdf_ready : true
}

/** One guide in any of its formats, with Expandir and Abrir no navegador for each. */
export function UIGuideViewer({ sessionId, guide }: { sessionId: string; guide: UIGuide }) {
  const [format, setFormat] = useState<GuideFormat>(() => defaultGuideFormat(guide))
  const [expanded, setExpanded] = useState(false)
  const [openError, setOpenError] = useState('')
  useEffect(() => { setFormat(guide.html_ready ? 'html' : guide.pdf_ready ? 'pdf' : 'md'); setOpenError('') }, [guide.id, guide.html_ready, guide.pdf_ready])
  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])
  const openInBrowser = async () => {
    setOpenError('')
    const bridge = desktopBridge()?.uiTesting
    try {
      if (bridge) await bridge.openGuide({ sessionId, runId: guide.run_id, format })
      else window.open(uiTestingApi.asset(sessionId, guide.run_id, FORMAT_FILE[format]), '_blank', 'noopener')
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error))
    }
  }
  const content = <GuideContent sessionId={sessionId} guide={guide} format={format}/>
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1">
        <WorkbenchTabs label="Formato do guia" value={format} onChange={setFormat} items={(['html', 'pdf', 'md'] as const).map((id) => ({
          id, label: FORMAT_LABEL[id], icon: id === 'html' ? 'monitor' : id === 'pdf' ? 'file' : 'code', disabled: !available(guide, id),
        }))}/>
      </div>
      <button type="button" className={uiSecondaryButtonClass} onClick={() => setExpanded(true)}><Icon name="collapse" size={12}/>Expandir</button>
      <button type="button" className={uiSecondaryButtonClass} onClick={() => void openInBrowser()}><Icon name="external" size={12}/>Abrir no navegador</button>
    </div>
    {openError && <p role="alert" className="text-base text-whx-danger">{openError}</p>}
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-whx-border bg-whx-surface">{content}</div>
    {expanded && <div role="dialog" aria-modal="true" aria-label={`${guide.title} — ${FORMAT_LABEL[format]}`} className="fixed inset-0 z-50 flex flex-col gap-2 bg-black/80 p-4 backdrop-blur-sm">
      <header className="flex items-center gap-2 text-sm text-white">
        <strong className="min-w-0 flex-1 truncate">{guide.title}</strong>
        <span className="text-base text-white/60">{FORMAT_LABEL[format]}</span>
        <button type="button" className={uiSecondaryButtonClass} onClick={() => void openInBrowser()}><Icon name="external" size={12}/>Abrir no navegador</button>
        <button type="button" className={uiSecondaryButtonClass} aria-label="Fechar vista expandida" onClick={() => setExpanded(false)}><Icon name="close" size={12}/></button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-whx-border bg-whx-bg">{content}</div>
    </div>}
  </div>
}

function GuideContent({ sessionId, guide, format }: { sessionId: string; guide: UIGuide; format: GuideFormat }) {
  if (format === 'md') {
    return <div className="h-full overflow-auto p-4"><MarkdownContent markdown={resolveGuideImages(guide.markdown, (name) => uiTestingApi.asset(sessionId, guide.run_id, name))}/></div>
  }
  const src = uiTestingApi.asset(sessionId, guide.run_id, FORMAT_FILE[format])
  // The HTML guide runs only its own engine-rendered script: no same-origin access to the app.
  return format === 'html'
    ? <iframe title={`Guia ${guide.title}`} className="h-full min-h-0 w-full bg-white" sandbox="allow-scripts" src={src}/>
    : <iframe title={`PDF ${guide.title}`} className="h-full min-h-0 w-full bg-white" src={src}/>
}
