import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './theme.css'
import './plan-control.css'
import './activity-history.css'
import './operational-panels.css'
import './restart-confirmation.css'
import { loadMonaco } from './lib/monaco'
import { applyUIPreferences, loadUIPreferences, subscribeUIPreferences } from './lib/uiPreferences'
import { api } from './lib/api'
import { applyInterfaceLanguage } from './lib/languageSettings'

async function start() {
  applyUIPreferences(loadUIPreferences())
  subscribeUIPreferences(() => {})
  void api.languageSettings().then(applyInterfaceLanguage).catch(() => undefined)
  await loadMonaco()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
