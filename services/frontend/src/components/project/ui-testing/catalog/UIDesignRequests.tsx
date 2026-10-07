import type { UITestDesignRequest } from '../../../../types'
import { uiSecondaryButtonClass } from '../uiTestingStyles'

/** Operator design requests still worth showing: in flight, failed or just finished. */
export function UIDesignRequests({ designs, onDismiss }: { designs: UITestDesignRequest[]; onDismiss: (taskId: string) => void }) {
  if (!designs.length) return null
  return <ul aria-label="Pedidos de novos testes" className="m-0! list-none space-y-1.5 p-0!">
    {designs.map((design) => <li key={design.task_id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-base ${tone[design.status]}`}>
      <span className="min-w-0 flex-1">
        <strong className="block">{label(design)}</strong>
        <span className="line-clamp-2 text-whx-soft">{design.brief}</span>
        {design.status === 'failed' && design.error && <span className="mt-1 block text-whx-danger">{design.error}</span>}
      </span>
      {design.status !== 'designing' && <button className={uiSecondaryButtonClass} onClick={() => onDismiss(design.task_id)}>Dispensar</button>}
    </li>)}
  </ul>
}

const tone: Record<UITestDesignRequest['status'], string> = {
  designing: 'border-whx-accent/30 bg-whx-accent-soft/30',
  done: 'border-whx-success/30 bg-whx-success/10',
  failed: 'border-whx-danger/30 bg-whx-danger/10',
}

function label(design: UITestDesignRequest) {
  if (design.status === 'designing') return 'GPT a desenhar o teste…'
  if (design.status === 'failed') return 'O desenho do teste falhou'
  const count = design.test_ids?.length || 0
  return `${count} teste${count === 1 ? '' : 's'} adicionado${count === 1 ? '' : 's'} ao catálogo`
}
