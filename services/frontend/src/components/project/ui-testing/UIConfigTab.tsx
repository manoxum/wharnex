import { useEffect, useState } from 'react'
import type { UITestEnvironment, UITestingDocument } from '../../../types'
import { uiSecondaryButtonClass } from './uiTestingStyles'

export function UIConfigTab({ doc, busy, onSave }: { doc: UITestingDocument; busy: boolean; onSave: (input: { environment_id: string; profile_id?: string; url?: string; username?: string; password?: string }) => Promise<void> }) {
  return <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">{doc.environments.map((env) => <EnvironmentCard key={env.id} env={env} busy={busy} onSave={onSave}/>)}</div>
}
function EnvironmentCard({ env, busy, onSave }: { env: UITestEnvironment; busy: boolean; onSave: UIConfigTabProps['onSave'] }) {
  const [url, setURL] = useState(env.url || '')
  useEffect(() => setURL(env.url || ''), [env.url])
  return <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
    <header className="mb-3"><strong className="text-sm">{env.name}</strong><p className="mt-1 text-xs text-[var(--theme-text-muted)]">{env.description || 'Aplicação/ambiente definido pelo GPT.'}</p></header>
    <label className="mb-3 block text-xs">URL do ambiente<input className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2" value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://app.exemplo.local"/></label>
    {!env.profiles.length && <button className={uiSecondaryButtonClass} disabled={busy || !url} onClick={() => void onSave({ environment_id:env.id, url })}>Guardar URL</button>}
    <div className="space-y-2">{env.profiles.map((profile) => <ProfileRow key={profile.id} env={env} url={url} profile={profile} busy={busy} onSave={onSave}/>)}</div>
  </section>
}
function ProfileRow({ env, url, profile, busy, onSave }: { env: UITestEnvironment; url: string; profile: UITestEnvironment['profiles'][number]; busy: boolean; onSave: UIConfigTabProps['onSave'] }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('')
  return <div className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="mb-2 flex items-center justify-between"><span><strong className="text-xs">{profile.label}</strong><small className="ml-2 text-[10px] text-[var(--theme-text-muted)]">{profile.role}</small></span><span className={`text-[10px] ${profile.configured ? 'text-emerald-400' : 'text-amber-300'}`}>{profile.configured ? 'configurado' : 'por configurar'}</span></div><div className="grid gap-2 sm:grid-cols-2"><input aria-label={`Utilizador ${profile.label}`} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={profile.configured ? 'Utilizador guardado' : 'Utilizador'}/><input aria-label={`Senha ${profile.label}`} type="password" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={profile.configured ? '••••••••' : 'Senha'}/></div><button className={`${uiSecondaryButtonClass} mt-2`} disabled={busy || !url || (!profile.configured && (!username || !password))} onClick={() => void onSave({ environment_id:env.id, profile_id:profile.id, url, username, password })}>Guardar perfil</button></div>
}
type UIConfigTabProps = { onSave: (input: { environment_id: string; profile_id?: string; url?: string; username?: string; password?: string }) => Promise<void> }
