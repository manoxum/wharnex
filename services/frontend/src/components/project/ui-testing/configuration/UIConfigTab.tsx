import { useEffect, useState } from 'react'
import type { UITestEnvironment } from '../../../../types'
import { Icon } from '../../../presentation/chrome/Icon'
import { uiInputClass, uiSecondaryButtonClass } from '../uiTestingStyles'
import type { ConfigurationProps, SaveInput } from './configurationTypes'
import { ProfileFields } from './ProfileFields'
import { SessionList } from './SessionList'

export function UIConfigTab(props: ConfigurationProps) {
  return <div className="@container min-h-0 flex-1 space-y-4 overflow-auto p-4 text-whx-text">
    <header><h3 className="m-0! text-lg! font-semibold!">Ambientes e acesso</h3><p className="mb-0! mt-1! text-base! text-whx-faint">Configure a aplicação e os perfis usados pelos testes.</p></header>
    {!props.doc.environments.length && <p className="text-base text-whx-faint">Sincronize o catálogo para descobrir os ambientes do projeto.</p>}
    {props.doc.environments.map((env) => <EnvironmentCard key={env.id} env={env} {...props}/>)}
  </div>
}
function EnvironmentCard({ env, doc, busy, onSave, onClearSessions }: ConfigurationProps & { env: UITestEnvironment }) {
  const [url, setURL] = useState(env.url || '')
  useEffect(() => setURL(env.url || ''), [env.url])
  const sessions = (doc.sessions || []).filter((session) => session.environment_id === env.id)
  const publicTests = doc.tests.filter((test) => test.environment_id === env.id && test.access === 'public').length
  return <section className="rounded-lg border border-whx-border bg-whx-surface p-4">
    <header className="mb-4 flex items-start gap-2"><span className="mt-0.5 text-whx-faint"><Icon name="server" size={15}/></span><div><strong className="text-lg">{env.name}</strong><p className="mb-0! mt-1! text-base! leading-5! text-whx-faint">{env.description || 'Aplicação/ambiente definido pelo GPT.'}</p></div></header>
    <label className="block text-sm text-whx-faint">URL do ambiente<input className={`${uiInputClass} mt-1`} value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://app.exemplo.local"/></label>
    <div className="mb-4 mt-2 flex flex-wrap items-center gap-2"><button className={uiSecondaryButtonClass} disabled={busy || !url || url === (env.url || '')} onClick={() => void onSave({ environment_id: env.id, url }).catch(() => undefined)}>Guardar URL</button>{publicTests > 0 && <span className="text-sm text-whx-faint">{publicTests} testes públicos usam apenas a URL.</span>}</div>
    <NotesField env={env} busy={busy} onSave={onSave}/>
    {env.profiles.length > 0 && <div className="mt-4 space-y-3 border-t border-whx-border pt-4"><h4 className="m-0! text-base! font-semibold!">Perfis de acesso</h4>{env.profiles.map((profile) => <ProfileFields key={profile.id} env={env} url={url} profile={profile} busy={busy} onSave={onSave}/>)}</div>}
    <SessionList sessions={sessions} doc={doc} busy={busy} onClear={onClearSessions ? () => onClearSessions(env.id) : undefined}/>
  </section>
}
function NotesField({ env, busy, onSave }: { env: UITestEnvironment; busy: boolean; onSave: (input: SaveInput) => Promise<void> }) {
  const [notes, setNotes] = useState(env.notes || '')
  useEffect(() => setNotes(env.notes || ''), [env.notes])
  return <div>
    <label className="block text-sm text-whx-faint">Notas para o GPT<textarea aria-label={`Notas ${env.name}`} rows={3} maxLength={4000} className={`${uiInputClass} mt-1 h-auto! min-h-24 resize-y`} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Identificadores reais, registos existentes e dados de exemplo…"/></label>
    <div className="mt-2 flex flex-wrap items-center gap-2"><button className={uiSecondaryButtonClass} disabled={busy || notes === (env.notes || '')} onClick={() => void onSave({ environment_id: env.id, notes }).catch(() => undefined)}>Guardar notas</button><span className="text-sm text-whx-warning">Enviadas ao GPT: nunca coloque senhas ou tokens.</span></div>
  </div>
}
