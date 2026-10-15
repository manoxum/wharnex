import { createRoot } from 'react-dom/client'
import '../../src/styles/index.css'
import { CodexFixture } from './CodexFixture'
import { installFixtureBridge } from './bridge'
installFixtureBridge()
createRoot(document.getElementById('root')!).render(<CodexFixture/>)
