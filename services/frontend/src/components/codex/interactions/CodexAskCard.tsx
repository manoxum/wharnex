import { useState, type FormEvent } from 'react'
import type { CodexAsk, CodexAnswer } from '../../../lib/codex'
import { Icon } from '../../presentation/chrome/Icon'
import { codexButton, codexPrimaryButton } from '../presentation'

export function CodexAskCard({ ask, onAnswer }: { ask: CodexAsk; onAnswer: (answer: CodexAnswer) => Promise<unknown> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function reply(response: CodexAnswer) {
    setBusy(true); setError('')
    try { await onAnswer(response) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível responder ao Codex.'); setBusy(false) }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void reply({ answers: Object.fromEntries(ask.questions.map((question) => [question.id, { answers: [answers[question.id] || ''] }])) })
  }
  return <section className="my-5 rounded-xl border border-whx-accent/40 bg-whx-accent-soft/30 p-4 text-[calc(11px*var(--ui-font-scale))]" aria-label="Codex aguarda resposta">
    <div className="mb-4 flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-whx-accent-soft text-whx-accent"><Icon name={ask.kind === 'questions' ? 'chatgpt' : 'shield'} size={17}/></span><div><h4 className="m-0 text-[calc(12px*var(--ui-font-scale))] font-semibold leading-5 text-whx-text">{ask.kind === 'questions' ? 'Codex precisa da sua resposta' : 'Codex solicita autorização'}</h4><p className="mb-0 mt-1 text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-faint">{ask.kind === 'questions' ? 'Responda abaixo para continuar este pedido.' : 'Reveja os detalhes antes de decidir.'}</p></div></div>
    {ask.kind === 'questions' ? <form onSubmit={submit} className="flex flex-col gap-4">
      {ask.questions.map((question) => <fieldset key={question.id} className="m-0 min-w-0 border-0 p-0" disabled={busy}>
        <legend className="mb-3 text-[calc(11px*var(--ui-font-scale))] font-medium leading-6 text-whx-text">{question.question}</legend>
        {question.options?.map((option) => <label key={option.label} className={`mb-2 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-[calc(11px*var(--ui-font-scale))] leading-5 transition-colors ${answers[question.id] === option.label ? 'border-whx-accent/50 bg-whx-accent-soft/50' : 'border-whx-border-soft bg-whx-surface hover:border-whx-accent/40'}`}>
          <input type="radio" className="!mt-1 !h-auto !w-auto shrink-0 accent-whx-accent focus-visible:!outline-whx-accent" name={`${ask.id}-${question.id}`} checked={answers[question.id] === option.label} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}/>
          <span><strong className="font-medium">{option.label}</strong><span className="mt-1 block text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{option.description}</span></span>
        </label>)}
        {(!question.options?.length || question.isOther) && <input type={question.isSecret ? 'password' : 'text'} autoComplete="off" aria-label={question.header || question.question}
          placeholder={question.options?.length ? 'Ou escreva a sua resposta…' : 'Escreva a sua resposta…'}
          className="!h-auto !min-h-10 !w-full !rounded-lg !border !border-whx-border-soft !bg-whx-surface !p-3 !font-sans !text-[calc(11px*var(--ui-font-scale))] !text-whx-text focus-visible:!outline-whx-accent"
          value={question.options?.some((option) => option.label === answers[question.id]) ? '' : answers[question.id] || ''}
          onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}/>}
      </fieldset>)}
      <button type="submit" className={`${codexPrimaryButton} self-start`} disabled={busy || ask.questions.some((question) => !answers[question.id]?.trim())}><Icon name="send" size={14}/>{busy ? 'A enviar…' : 'Responder ao Codex'}</button>
    </form> : <>
      {ask.reason && <p className="my-2 leading-6 text-whx-soft">{ask.reason}</p>}
      {ask.command && <pre className="my-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-whx-border-soft bg-whx-surface p-3 font-mono text-[calc(10px*var(--ui-font-scale))] leading-5">{ask.command}</pre>}
      {ask.cwd && <p className="break-all font-mono text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-faint">{ask.cwd}</p>}
      {ask.permissions != null && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[calc(10px*var(--ui-font-scale))] leading-5">{JSON.stringify(ask.permissions, null, 2)}</pre>}
      <div className="mt-4 flex flex-wrap gap-2">{(ask.kind === 'permissions' || ask.availableDecisions.includes('accept')) && <button type="button" className={codexPrimaryButton} disabled={busy} onClick={() => void reply({ decision: 'accept' })}>Permitir uma vez</button>}
        <button type="button" className={codexButton} disabled={busy} onClick={() => void reply({ decision: 'decline' })}>Recusar</button></div>
    </>}
    {error && <p role="alert" className="mb-0 mt-3 text-[calc(11px*var(--ui-font-scale))] leading-5 text-whx-warning">{error}</p>}
  </section>
}
