import { createRoot } from 'react-dom/client'
import '../../src/styles/index.css'
import { UITestingPanel } from '../../src/components/project/ui-testing/UITestingPanel'
import type { Session } from '../../src/types'

createRoot(document.getElementById('root')!).render(<main id="lab-owner" className="mx-auto h-screen w-[880px] max-w-full overflow-hidden border-x border-whx-border bg-whx-bg">
  <UITestingPanel session={{ id: 'ui-lab-fixture' } as Session} onError={(message) => { throw new Error(message) }}/>
</main>)
