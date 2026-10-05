import { useEffect, useState } from 'react'
import type { UITestEnvironment, UITestingDocument, UITestSession } from '../../../types'
import { uiSecondaryButtonClass } from './uiTestingStyles'

type SaveInput = { environment_id: string; profile_id?: string; url?: string; username?: string; password?: string; notes?: string }
type UIConfigTabProps = { doc: UITestingDocument; busy: boolean; onSave: (input: SaveInput) => Promise<void>; onClearSessions?: (environmentId: string) => void }

export function UIConfigTab({ doc, busy, onSave, onClearSessions }: UIConfigTabProps) {
  return <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">{doc.environments.map((env) => <EnvironmentCard key={env.id} env={env} doc={doc} busy={busy} onSave={onSave} onClearSessions={onClearSessions}/>)}</div>
}
function EnvironmentCard({ env, doc, busy, onSave, onClearSessions }: { env: UITestEnvironment; doc: UITestingDocument; busy: boolean; onSave: (input: SaveInput) => Promise<void>; onClearSessions?: (environmentId: string) => void }) {
  const [url, setURL] = useState(env.url || '')
  useEffect(() => setURL(env.url || ''), [env.url])
  const sessions = (doc.sessions || []).filter((session) => session.environment_id === env.id)
  const publicTests = doc.tests.filter((test) => test.environment_id === env.id && test.access === 'public').length
  return <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
    <header className="mb-3"><strong className="text-sm">{env.name}</strong><p className="mt-1 text-xs text-[var(--theme-text-muted)]">{env.description || 'Aplicação/ambiente definido pelo GPT.'}</p></header>
    <label className="mb-2 block text-xs">URL do ambiente<input className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2" value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://app.exemplo.local"/></label>
    <div className="mb-3 flex items-center gap-2"><button className={uiSecondaryButtonClass} disabled={busy || !url || url === (env.url || '')} onClick={() => void onSave({ environment_id:env.id, url })}>Guardar URL</button>{publicTests > 0 && <span className="text-[10px] text-[var(--theme-text-muted)]">{publicTests} teste{publicTests === 1 ? '' : 's'} público{publicTests === 1 ? '' : 's'} só precisa{publicTests === 1 ? '' : 'm'} da URL.</span>}</div>
    <NotesField env={env} busy={busy} onSave={onSave}/>
    <div className="space-y-2">{env.profiles.map((profile) => <ProfileRow key={profile.id} env={env} url={url} profile={profile} busy={busy} onSave={onSave}/>)}</div>
    <SessionList sessions={sessions} doc={doc} busy={busy} onClear={onClearSessions ? () => onClearSessions(env.id) : undefined}/>
  </section>
}
function ProfileRow({ env, url, profile, busy, onSave }: { env: UITestEnvironment; url: string; profile: UITestEnvironment['profiles'][number]; busy: boolean; onSave: (input: SaveInput) => Promise<void> }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('')
  return <div className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="mb-2 flex items-center justify-between"><span><strong className="text-xs">{profile.label}</strong><small className="ml-2 text-[10px] text-[var(--theme-text-muted)]">{profile.role}</small></span><span className={`text-[10px] ${profile.configured ? 'text-emerald-400' : 'text-amber-300'}`}>{profile.configured ? 'configurado' : 'por configurar'}</span></div><div className="grid gap-2 sm:grid-cols-2"><input aria-label={`Utilizador ${profile.label}`} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={profile.configured ? 'Utilizador guardado' : 'Utilizador'}/><input aria-label={`Senha ${profile.label}`} type="password" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={profile.configured ? '••••••••' : 'Senha'}/></div><button className={`${uiSecondaryButtonClass} mt-2`} disabled={busy || !url || (!profile.configured && (!username || !password))} onClick={() => void onSave({ environment_id:env.id, profile_id:profile.id, url, username, password })}>Guardar perfil</button></div>
}
function SessionList({ sessions, doc, busy, onClear }: { sessions: UITestSession[]; doc: UITestingDocument; busy: boolean; onClear?: () => void }) {
  if (!sessions.length) return null
  const title = (id: string) => doc.tests.find((test) => test.id === id)?.title || id
  return <div className="mt-3 rounded-lg border border-white/10 bg-black/10 p-3 text-xs">
    <div className="mb-2 flex items-center justify-between"><strong>Sessões guardadas</strong>{onClear && <button className={uiSecondaryButtonClass} disabled={busy} onClick={onClear}>Limpar sessões</button>}</div>
    <p className="mb-2 text-[10px] text-[var(--theme-text-muted)]">Testes dependentes retomam destas sessões em vez de repetir os pré-requisitos. Ficam cifradas e expiram automaticamente.</p>
    <ul className="space-y-1">{sessions.map((session) => <li key={session.id} className="flex items-center gap-2"><span className={session.valid ? 'text-emerald-400' : 'text-amber-300'}>●</span><span className="min-w-0 flex-1 truncate">Após “{title(session.test_id)}”</span><span className="text-[10px] text-[var(--theme-text-muted)]">{session.valid ? `expira ${new Date(session.expires_at).toLocaleTimeString()}` : 'desatualizada'}</span></li>)}</ul>
  </div>
}
function NotesField({ env, busy, onSave }: { env: UITestEnvironment; busy: boolean; onSave: (input: SaveInput) => Promise<void> }) {
  const [notes, setNotes] = useState(env.notes || '')
  useEffect(() => setNotes(env.notes || ''), [env.notes])
  return <div className="mb-3">
    <label className="block text-xs">Notas para o GPT<textarea aria-label={`Notas ${env.name}`} rows={3} maxLength={4000} className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Dados de referência reais: identificadores de registos existentes, valores de exemplo…"/></label>
    <div className="mt-1 flex items-center gap-2"><button className={uiSecondaryButtonClass} disabled={busy || notes === (env.notes || '')} onClick={() => void onSave({ environment_id: env.id, notes })}>Guardar notas</button><span className="text-[10px] text-amber-300">Enviadas ao GPT: nunca coloque senhas ou tokens.</span></div>
  </div>
}
