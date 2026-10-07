import { useState } from 'react'
import type { UITestEnvironment } from '../../../types'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { Icon } from '../../presentation/chrome/Icon'
import { uiInputClass, uiPrimaryButtonClass, uiSecondaryButtonClass } from './uiTestingStyles'

const MAX_BRIEF = 8000

type UITestDesignComposerProps = {
  environments: UITestEnvironment[]
  busy: boolean
  onClose: () => void
  onSubmit: (input: { brief: string; environment_id?: string }) => Promise<void>
}

/** Composer where the operator describes a test for GPT to design. */
export function UITestDesignComposer({ environments, busy, onClose, onSubmit }: UITestDesignComposerProps) {
  const [brief, setBrief] = useState('')
  const [environmentId, setEnvironmentId] = useState('')
  const text = brief.trim()
  const submit = async () => {
    if (!text || text.length > MAX_BRIEF || busy) return
    try {
      await onSubmit({ brief: text, ...(environmentId ? { environment_id: environmentId } : {}) })
      onClose()
    } catch { /* the panel already surfaced the error; keep the draft for a retry */ }
  }
  return <InternalWindow title="Novo teste UI" onClose={onClose} closeDisabled={busy}>
    <section role="dialog" aria-modal="false" aria-label="Novo teste UI" className="flex w-[min(640px,calc(100vw-32px))] flex-col gap-3 rounded-lg border border-whx-border bg-whx-bg p-4 text-whx-text shadow-[0_28px_80px_var(--theme-shadow)]">
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-whx-accent-soft text-whx-accent"><Icon name="sparkles" size={16}/></span>
        <div><strong className="block text-lg">Descreva o teste que quer incluir</strong><p className="mt-1 text-base leading-5 text-whx-faint">O GPT recebe o contexto do projeto e o catálogo atual, desenha a estratégia de execução e reutiliza testes existentes (por exemplo, o login) como pré-requisitos.</p></div>
      </header>
      <label className="text-base">Ambiente<select className={`${uiInputClass} mt-1`} value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
        <option value="">Deixar o GPT decidir</option>
        {environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
      </select></label>
      <label className="text-base">Descrição do teste<textarea autoFocus aria-label="Descrição do teste" rows={8} maxLength={MAX_BRIEF} className={`${uiInputClass} mt-1 h-auto! min-h-32 resize-y`} value={brief} onChange={(event) => setBrief(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit() } }} placeholder="Ex.: Depois de entrar como administrador, criar um item com nome repetido e confirmar que aparece a mensagem de erro de duplicado; o item original não deve ser alterado."/></label>
      <footer className="flex items-center justify-between gap-2">
        <span className="text-sm text-whx-faint">{text.length}/{MAX_BRIEF} · Ctrl+Enter para enviar</span>
        <div className="flex gap-2"><button className={uiSecondaryButtonClass} disabled={busy} onClick={onClose}>Cancelar</button><button className={uiPrimaryButtonClass} disabled={busy || !text} onClick={() => void submit()}><Icon name="send" size={13}/> Desenhar teste</button></div>
      </footer>
    </section>
  </InternalWindow>
}
