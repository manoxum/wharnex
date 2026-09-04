import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './theme.css'
import { loadMonaco } from './lib/monaco'
import { applyUIPreferences, loadUIPreferences, subscribeUIPreferences } from './lib/uiPreferences'

async function start() {
  applyUIPreferences(loadUIPreferences())
  subscribeUIPreferences(() => {})
  await loadMonaco()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
