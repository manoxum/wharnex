import { translate as uiText } from '../../../../lib/workspace/localization'
import { ContentSkeleton } from '../../../presentation/chrome/Skeleton'
import { Button } from '../../../presentation/workbench'

export function ContextSettingsState({ error, snapshot = false, onRetry }: { error?: string; snapshot?: boolean; onRetry: () => void }) {
  if (error) return <div role="alert" className="grid max-w-[680px] gap-3 p-6 text-whx-label text-whx-soft">
    <strong className="font-semibold text-whx-danger">{snapshot ? uiText("Não foi possível inspecionar o contexto") : uiText("Não foi possível carregar a configuração")}</strong>
    <p className="!m-0 break-words font-mono !text-whx-label !leading-relaxed !text-whx-soft">{error}</p>
    {!snapshot && <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">{uiText("O backend tenta recriar automaticamente")}{' '}<code>whaness.yml</code> {' '}{uiText("quando ele não existe. Pode tentar novamente sem fechar o projeto.")}</p>}
    <div><Button icon="refresh" onClick={onRetry}>{uiText("Tentar novamente")}</Button></div>
  </div>
  const label = snapshot ? 'A inspecionar o snapshot final…' : 'A carregar configuração…'
  return <div role="status" aria-busy="true" className="grid max-w-[680px] gap-2 p-5">
    <span className="text-whx-label text-whx-faint">{uiText(label)}</span>
    <ContentSkeleton label={uiText(label)} rows={snapshot ? 2 : 3} compact/>
  </div>
}
