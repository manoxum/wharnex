import { useState } from 'react'
import { CodexPanel } from '../../src/components/codex/surface'
import { ComposerSessionControls } from '../../src/components/chat/composer/ComposerSessionControls'
import { createCodexComposerControls, type PlannerChatConfiguration } from '../../src/lib/codex'
import { completeFixtureTurn, pauseFixtureQuota, requestFixtureAnswer } from './bridge'
import { nativeFixture } from './nativeFixture'
import { IncrementalComposer } from './IncrementalComposer'
export function CodexFixture() {
  const [chat, setChat] = useState<PlannerChatConfiguration>({ engine: 'codex' })
  const controls = createCodexComposerControls(chat, false, false, (patch) => setChat((current) => ({ ...current, ...patch })))
  if (new URLSearchParams(location.search).has('incremental')) return <main className="flex h-screen flex-col bg-whx-bg text-whx-text"><CodexPanel projectPath="/workspace/wharnex" chatId="chat-parser"/><IncrementalComposer/></main>
  return <main className="flex h-screen min-h-0 flex-col bg-whx-bg text-whx-text">
    <div className="border-b border-whx-border-soft px-5 py-3 font-mono text-xs">Wharnex / integração Codex</div>
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_400px]">
      <section className="hidden min-h-0 flex-col border-r border-whx-border-soft p-8 md:flex"><h1 className="text-lg">{nativeFixture ? 'Corrigir o retry' : 'Rever a validação dos bundles'}</h1><p className="text-sm leading-6 text-whx-soft">{nativeFixture ? 'O Codex trabalha no projeto e apresenta a atividade e as perguntas no Engine.' : 'O mesmo composer liga o pedido ao engine escolhido. Plano, execução e aprovações continuam no Wharnex.'}</p><pre className="mt-8 rounded-lg border border-whx-border-soft bg-whx-surface p-5 text-xs leading-7 text-whx-soft">{nativeFixture ? 'Prompt + anexos selecionados\n    ↓\nCodex Native\n    ↓\nFicheiros no computador' : 'request.zip\n    ↓\nCodex · planner\n    ↓\nresponse.zip\n    ↓\nValidação · Policy · Protected'}</pre>{nativeFixture ? <div className="mt-auto flex flex-wrap gap-3"><button onClick={requestFixtureAnswer}>Pedir decisão de teste</button><button onClick={pauseFixtureQuota}>Simular quota esgotada</button></div> : <button className="mt-auto self-start" onClick={completeFixtureTurn}>Concluir turno de teste</button>}</section>
      <div id="codex-owner" className="flex min-h-0 flex-col"><div className="min-h-0 flex-1"><CodexPanel projectPath="/workspace/wharnex" chatId="chat-parser"/></div><div className="border-t border-whx-border-soft p-3"><textarea aria-label="Pedido ao engine" placeholder="Peça uma alteração…" className="!min-h-20 !w-full !resize-none !rounded-xl !border-whx-border-soft !bg-whx-muted !p-3 !text-sm"/><div className="mt-2 flex flex-wrap gap-2"><ComposerSessionControls projectPath="/workspace/wharnex" workspaceChatId="chat-parser" {...controls} session={{ automation_mode: 'manual', reasoning_effort: 'high', context_mode: 'full', chat_transport_mode: 'scraper' }} requestActive={false}/></div></div></div>
    </div>
  </main>
}
