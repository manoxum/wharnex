import { useState } from 'react'
import type { UITestEnvironment } from '../../../../types'
import { uiInputClass, uiSecondaryButtonClass } from '../uiTestingStyles'
import type { SaveInput } from './configurationTypes'

export function ProfileFields({ env, url, profile, busy, onSave }: { env: UITestEnvironment; url: string; profile: UITestEnvironment['profiles'][number]; busy: boolean; onSave: (input: SaveInput) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const credentialsReady = Boolean(username && password)
  async function save() {
    await onSave({ environment_id: env.id, profile_id: profile.id, url, username, password })
    // Clear secrets only after success; a rejected save keeps the draft.
    setUsername('')
    setPassword('')
  }
  return <section className="rounded-lg border border-whx-border bg-whx-bg p-3">
    <header className="mb-3 flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1"><strong className="text-base">{profile.label}</strong><p className="m-0! text-sm! leading-5! text-whx-faint">{profile.role}</p></div>
      <span className={`rounded px-2 py-0.5 text-sm ${profile.configured ? 'bg-whx-success/10 text-whx-success' : 'bg-whx-warning/10 text-whx-warning'}`}>{profile.configured ? 'Configurado' : 'Por configurar'}</span>
    </header>
    <div className="grid gap-3 @min-[480px]:grid-cols-2">
      <label className="text-sm text-whx-faint">Utilizador<input aria-label={`Utilizador ${profile.label}`} autoComplete="off" className={`${uiInputClass} mt-1`} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={profile.configured ? 'Utilizador guardado' : 'Utilizador'}/></label>
      <label className="text-sm text-whx-faint">Senha<input aria-label={`Senha ${profile.label}`} autoComplete="new-password" type="password" className={`${uiInputClass} mt-1`} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={profile.configured ? '••••••••' : 'Senha'}/></label>
    </div>
    <button className={`${uiSecondaryButtonClass} mt-3`} disabled={busy || !url || !credentialsReady} onClick={() => void save().catch(() => undefined)}>Guardar perfil</button>
  </section>
}
