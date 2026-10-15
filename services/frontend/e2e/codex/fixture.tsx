import { createRoot } from 'react-dom/client'
import '../../src/styles/index.css'
import { CodexFixture } from './CodexFixture'
import { installFixtureBridge } from './bridge'
import { installCompletionObserver } from './completionBridge'
installFixtureBridge()
installCompletionObserver()
createRoot(document.getElementById('root')!).render(<CodexFixture/>)
