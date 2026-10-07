import type { UITestingDocument, UITestSession } from '../../../../types'
import { uiSecondaryButtonClass } from '../uiTestingStyles'

export function SessionList({ sessions, doc, busy, onClear }: { sessions: UITestSession[]; doc: UITestingDocument; busy: boolean; onClear?: () => void }) {
  if (!sessions.length) return null
  const title = (id: string) => doc.tests.find((test) => test.id === id)?.title || id
  return <section className="mt-4 border-t border-whx-border pt-4">
    <div className="mb-2 flex flex-wrap items-center gap-2"><strong className="flex-1 text-base">Sessões guardadas</strong>{onClear && <button className={uiSecondaryButtonClass} disabled={busy} onClick={onClear}>Limpar sessões</button>}</div>
    <p className="mb-3 text-sm leading-5 text-whx-faint">Os testes retomam destas sessões sem repetir os pré-requisitos. As sessões ficam cifradas e expiram automaticamente.</p>
    <ul className="m-0! list-none space-y-2 p-0!">{sessions.map((session) => <li key={session.id} className="flex flex-wrap items-center gap-2 text-base">
      <span aria-hidden="true" className={session.valid ? 'text-whx-success' : 'text-whx-warning'}>●</span><span className="min-w-0 flex-1">Após “{title(session.test_id)}”</span>
      <span className="text-sm text-whx-faint">{session.valid ? `Expira ${new Date(session.expires_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}` : 'Desatualizada'}</span>
    </li>)}</ul>
  </section>
}
