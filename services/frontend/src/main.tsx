import { LocaleRoot, applyDocumentLocale, initializeSystemLanguages } from './lib/workspace/localization'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/workspace/App'
import { BrowserMonitor } from './components/agent/browser-monitor/BrowserMonitor'
import './styles/index.css'
import { applyUIPreferences, loadUIPreferences, subscribeUIPreferences, syncUIPreferences } from './lib/workspace/preferences/uiPreferences'
import { api } from './lib/transport/http/api'
import { applyInterfaceLanguage } from './lib/project/connections/languageSettings'

function start() {
  applyDocumentLocale()
  void initializeSystemLanguages()
  if (new URLSearchParams(window.location.search).get('browserMonitor') === '1') {
    createRoot(document.getElementById('root')!).render(<StrictMode><LocaleRoot>{() => <BrowserMonitor />}</LocaleRoot></StrictMode>)
    return
  }
  const uiPreferences = loadUIPreferences()
  applyUIPreferences(uiPreferences)
  subscribeUIPreferences(() => {})
  void syncUIPreferences(uiPreferences).catch(() => undefined)
  void api.languageSettings().then(applyInterfaceLanguage).catch(() => undefined)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LocaleRoot>{() => <App />}</LocaleRoot>
    </StrictMode>,
  )
}

void start()
