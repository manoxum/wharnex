import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './styles/index.css'
import './theme.css'
import './plan-control.css'
import './activity-history.css'
import './operational-panels.css'
import './restart-confirmation.css'
import { applyUIPreferences, loadUIPreferences, subscribeUIPreferences } from './lib/uiPreferences'
import { api } from './lib/api'
import { applyInterfaceLanguage } from './lib/languageSettings'

function start() {
  applyUIPreferences(loadUIPreferences())
  subscribeUIPreferences(() => {})
  void api.languageSettings().then(applyInterfaceLanguage).catch(() => undefined)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
