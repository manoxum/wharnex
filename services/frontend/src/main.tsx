import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/workspace/App'
import './styles/index.css'
import { applyUIPreferences, loadUIPreferences, subscribeUIPreferences, syncUIPreferences } from './lib/workspace/preferences/uiPreferences'
import { api } from './lib/transport/http/api'
import { applyInterfaceLanguage } from './lib/project/connections/languageSettings'

function start() {
  const uiPreferences = loadUIPreferences()
  applyUIPreferences(uiPreferences)
  subscribeUIPreferences(() => {})
  void syncUIPreferences(uiPreferences).catch(() => undefined)
  void api.languageSettings().then(applyInterfaceLanguage).catch(() => undefined)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
