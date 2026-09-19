# Achados da sessão de 2026-09-18/19 — worker pool, performance e crash do desktop

Documento de análise técnica. Não é normativo (ver `AGENTS.md` §1 — autoridade: `AGENTS.md` > `SoT/*.md` > `SECURITY.md` > testes/schemas > implementação). Descreve o que foi investigado, corrigido e confirmado ao vivo nesta sessão, e — mais importante — **o que continua por resolver**, para uma sessão nova retomar sem perder o contexto já pago.

Ver também `FIX_WORKER_AND_TODO.md` (sessão anterior, já resolvida): timeout de upload, composer sujo entre tentativas, e reasoning-effort bloqueante no `TODO_CLASSIFY`. As três correções de lá seguem válidas e commitadas.

## Estado final: bug crítico NÃO resolvido

**O desktop entra em loop de crash do renderer principal** (`window=primary`), com uso de RAM subindo a 3-7GB em 15-45 segundos e o processo sendo morto (exitCode 5 ou 133). Depois do crash, a lógica de recovery do Electron tenta recarregar a janela e frequentemente bate numa race condition já documentada no próprio código (`services/desktop/main.mjs`, comentário perto de `archiveChatGPTConversation`): `TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null` — reload rápido demais depois de um crash reproduz esse erro do Electron/Chromium, gerando um segundo loop por cima do primeiro.

**Reproduzido de forma 100% consistente**: acontece dentro de ~15-45s de um `make restart` limpo, **sem qualquer interação do usuário** — não depende de abrir painéis, clicar em nada. Confirmado em pelo menos 6 tentativas ao vivo separadas, incluindo uma iniciada pelo próprio usuário (não por mim), com PIDs e timestamps diferentes cada vez.

### O que foi descartado como causa (com evidência)

| Hipótese | Evidência que descarta |
|---|---|
| Processos Electron órfãos de sessões anteriores | `ps aux \| grep wharness/electron` → 0 resultados depois de `make stop` |
| Perfil do Electron corrompido/inchado em disco | `~/.config/wharness-desktop` = 987MB total, nada fora do normal (Cache 561MB, Partitions 209MB) |
| Volume de dados no Postgres | `harness_chat_agent_tasks`: 43MB/717 linhas. `harness_events`: 18MB/62783 linhas. `harness_workspace_chats`: 1MB/113 linhas. `harness_chat_items`: 5.5MB/1790 linhas. Maior chat individual: 161KB. Tudo isso é irrisório frente a um crescimento de GBs em segundos |
| 622 sessões acumuladas | Confirmado como artefato do próprio volume de testes desta sessão (muitos `make restart` + reclassificações), não uma tabela carregada de uma vez em lugar nenhum |
| Falta de recursos do sistema | O usuário confirmou que a máquina tem recursos de sobra; e mesmo assim o crash reproduz de forma idêntica e rápida |
| Flapping do auto-scale (worker/supervisor pool oscilando grow/drain) | **Bug real, corrigido** (commit `c55c766`), mas o crash persistiu depois do fix |
| Broadcast de `wharness:agents:state` sem throttle (rajada de IPC) | **Mitigação real aplicada** (commit `c3b1182`), mas o crash persistiu |
| Ações de lifecycle (organizar/arquivar/apagar conversa, apagar artefato da biblioteca) sem o gate de pacing entre requisições ao provedor | **Bug real, corrigido** (commit `d3e2594`) — violava o próprio invariante do `AGENTS.md` §8 ("Worker navigation and autonomous submission MUST share one process-wide pacing gate"). Reproduzido ao vivo via um backlog de 136 `DELETE_BUNDLE` navegando `chatgpt.com/library` sem espaçamento nenhum. Mesmo assim, o crash persistiu depois do fix |
| Recriação do editor Monaco (`ChangeDiffEditor`) por identidade de objeto instável | **Bug real, confirmado e corrigido** (ver seção própria abaixo) — mas não explica *este* crash específico, porque reproduz em <20s de um restart limpo, antes de qualquer clique que monte esse componente |

### Pista forte ainda não fechada — Monaco Editor

O usuário capturou o painel Network do DevTools mostrando **449 requisições, 39.1MB transferidos, 90.1MB de recursos em 1.5min**, com os scripts de worker do Monaco (`html.worker-*.js`, `json.worker-*.js`, `css.worker-*.js`, `ts.worker-*.js`) sendo carregados **repetidamente**, com iniciadores incluindo `editor.main.js`, `loader.js` e **`panel-git-BOLGJMim.js`** (o chunk do painel Git criado nesta sessão pelo lazy-loading).

Investigando isso, encontrei e corrigi um bug real e concreto em `services/frontend/src/components/EditorWorkspace.tsx`: o `file={{ path: gitDiff.path, ... }}` era um **objeto literal inline no JSX**, recriado a cada render. Como `EditorWorkspace` fica **sempre montado** (nunca desmonta ao trocar de modo Agent/Orchestrator — só fica oculto via CSS), isso disparava `ChangeDiffEditor`'s `useLayoutEffect` (dependente de `[document, file.path]`) a descartar e recriar o editor de diff Monaco **inteiro — com 4 novos web workers — a cada re-render do app inteiro**, sempre que o painel de diff do Git estivesse aberto no Editor. Corrigido com `useMemo` (commit já absorvido em snapshot do self-evolution, ver `git log -- services/frontend/src/components/EditorWorkspace.tsx`). Teste de regressão em `EditorWorkspace.test.tsx` confirma a correção (passa).

**Por que isso não fecha o caso**: esse código só é montado depois de o usuário clicar no botão "Git diff" dentro do Editor. O crash reproduz em <20s de um restart limpo, sem nenhuma interação — logo essa via específica não pode ser a explicação para *este* crash automático. Ainda pode ser relevante para outros episódios (o usuário pode ter tido esse painel aberto quando tirou a screenshot do Network), mas **não é suficiente sozinha**.

Verifiquei `CodeEditor.tsx` (o editor de texto propriamente dito, que fica ativo bem mais frequentemente que o diff) e ele está corretamente implementado: `useLayoutEffect` de criação do Monaco tem `[]` como dependência (cria uma vez só), e usa o padrão de `ref` para `runActions` em vez de depender dele diretamente — não recria o editor a cada render. **Não é a causa.**

### Teste que ainda falta fazer

**Isolar por concorrência**: reduzir drasticamente o número de Workers/Supervisors simultâneos (ex: 1 e 1, via `chatAgentPolicies`/config) e ver se o crash ainda acontece com um backlog grande. Isso separaria "é proporcional ao número de `WebContentsView` concorrentes navegando ao mesmo tempo" de "é um bug pontual em algum código específico". Foi proposto ao usuário várias vezes nesta sessão mas nunca chegou a ser executado — é o próximo passo mais lógico.

Outras vias não tentadas por falta de ferramental nesta sessão:
- Heap snapshot real via `--inspect`/`chrome://inspect` no processo do renderer (não tenho acesso a DevTools remoto neste ambiente).
- Verificar se os crash dumps do Crashpad (`~/.config/wharness-desktop/Crashpad`) começam a aparecer em `pending/`/`completed/` depois de um crash — no momento em que chequei, o diretório só tinha `client_id`, sugerindo que o kernel Linux está matando o processo por OOM antes do Crashpad conseguir escrever um dump (isso é consistente com um crescimento de RSS mais rápido do que o normal para um crash "educado" do Chromium).
- Conferir se alguma conversa real do ChatGPT (não dado nosso) ficou anormalmente longa ao longo do dia e está pesada para carregar nas views de Supervisor/Worker que apontam para ela.

## Correções aplicadas e confirmadas nesta sessão (todas commitadas)

### Worker pool / automação ChatGPT (`services/desktop`)
- `eaee8f2` — `primeChatGPTWorkerPool` chamava `delay()` (nunca definido) em vez de `wait()`; crashava com `unhandledRejection` depois de criar só o primeiro worker slot. **Confirmado ao vivo**: os 3 workers agora sobem em sequência sem erro.
- `eaee8f2` — Tentativa de corrigir `menu-not-open` (RENAME_CHAT/ARCHIVE_CHAT/DELETE_TEMP_CHAT, 124/124 falhas desde 15/09) reabrindo o menu até 3x. **Não resolveu**: diagnóstico ao vivo mostrou o mesmo elemento sendo clicado (mesmo rect, `boundToConversation:false`) sem nunca produzir itens de menu — indica deriva de seletor na UI do ChatGPT, não um problema de timing. **Segue sem solução.**
- `feaa5cb` — TODO_CLASSIFY/TRANSLATE_MARKDOWN clicavam no botão de download a cada tick de poll (a cada resposta), disparando downloads reais duplicados; o sufixo de duplicata do Chromium (`"nome (2).zip"`) não era reconhecido pelo match exato, e a cópia extra caía como diálogo nativo de "Salvar Como" do SO — **causou o travamento da tela relatado ao vivo pelo usuário**. Corrigido: clique único por resposta + tolerância ao sufixo de duplicata (mesmo padrão já usado pelo Supervisor).
- `feaa5cb` — Botão de download do ChatGPT em português europeu usa "Transferir" (PT-BR usa "Baixar"); o regex não cobria isso. Corrigido.
- `feaa5cb` — TODO_CLASSIFY/TRANSLATE_MARKDOWN perdiam o texto do prompt (só o zip ia, sem instrução) porque a página inicial do ChatGPT troca de composer assim que o anexo chega. Corrigido reforçando o texto do composer imediatamente antes do submit.
- `9eb1e82` — `chatSession.clearCache()` rodava incondicionalmente em todo boot, forçando os Supervisors/Workers a rebaixar o SPA inteiro do ChatGPT da rede em vez do cache em disco. Só precisa rodar quando a UA espelhada (`CHATGPT_CHROMIUM_VERSION`) muda de verdade. Corrigido com um marcador persistido. **Medido ao vivo**: restart de ~61s (com rebuild) → ~5s (sem rebuild, cache preservado).
- `c55c766` — Auto-scale de workers/supervisors sem histerese: crescia e encolhia o pool a cada poll de 2s quando a demanda oscilava acima/abaixo de zero, criando e destruindo `WebContentsView` reais repetidamente. Corrigido com cooldown de 20s entre grow e drain.
- `c3b1182` — `publishChatAgentRuntimeState()` (chamada de ~26 lugares, vários deles handlers de evento do WebContents) inundava as janelas com broadcasts a cada evento. Agrupado para no máximo 1 envio por janela a cada 250ms, sempre entregando o estado mais recente.
- `d3e2594` — Ações de lifecycle da conta (organizar/arquivar/apagar conversa, apagar artefato da biblioteca) nunca respeitavam o gate de pacing entre requisições ao provedor, só a serialização (uma de cada vez, sem espaçamento). Um backlog de 136 `DELETE_BUNDLE` reproduziu isso ao vivo: navegação para `chatgpt.com/library` sem nenhum espaçamento. Corrigido chamando `paceChatGPTWorkerNavigation()` nas 4 funções afetadas.

### Frontend — performance de startup (`services/frontend`)
- `246b9fd` — 10 painéis raramente usados (Git, Postgres, Runtime, Tasks, Knowledge, Evolution, Explorer, Activity, Artifacts, TODO) eram importados estaticamente, inflando o bundle inicial. Convertidos para `React.lazy()` + `Suspense`, com `manualChunks` explícito no `vite.config.ts` (o code-splitting automático do Rollup não estava separando os chunks sozinho neste projeto, por razão não identificada). **Resultado medido**: chunk principal de 1.558KB → 822KB (−47%).
- Dentro do mesmo commit: `api.config()` era `await`ado antes do resto do `initialize()`, serializando uma chamada de rede sem motivo (nada depende do resultado antes do fluxo de hidratação de sessão). Desacoplado para rodar em paralelo.
- `0898132` — Skeletons com shimmer (`Skeleton.tsx`) para a tela de restauração do workspace e para os 10 painéis lazy, reaproveitando a mesma técnica de sheen já usada em `.context-publication-progress`.
- Correção adicional dentro do mesmo lote: `OrchestratorWorkspace` fazia polling a cada 5s mesmo com o modo Orchestrator oculto. Ganhou um prop `active` que gate o polling.
- `3d43ac8` + `ee707e1` — Os dois painéis laterais (esquerdo/direito) não conseguiam ficar abertos ao mesmo tempo (fechamento automático via `workbenchDrawersFit`). Removido o fechamento automático; os painéis agora usam `flex-shrink:1` (antes `0`) para encolher sob pressão em vez de forçar o fechamento do outro. **Correção intermediária** (`both-drawers-open` + `overflow-x:auto`) foi tentada e revertida a pedido do usuário (queria encolhimento real, não scroll).
- Correção subsequente: o `grid-template-columns` interno do chat/inspector tinha piso próprio de `320px+320px=646px`, que excedia 1/3 da tela em qualquer monitor comum e anulava o `min-width` do container externo. Relaxado para `minmax(0, ...)` em ambas as colunas, em 3 lugares no CSS (`.agent-workspace` base, variante `agent-rail-unified`, e a regra mais específica `.workspace-mode-surface > .agent-workspace` que estava vencendo por especificidade).
- Fix crítico de bug real (não fecha o crash principal, ver seção acima): `EditorWorkspace.tsx`'s diff do Git recriava o editor Monaco a cada render por causa de um objeto literal inline. Corrigido com `useMemo`.

### Feature nova: arquivar/eliminar TODOs (backend + frontend)
- Backend: campo `ArchivedAt` em `domain.ProjectTodo`, `Store.DeleteProjectTodo`, `Service.ArchiveProjectTodo`/`DeleteProjectTodo`, rotas `PATCH .../todos/{id}/archived` e `DELETE .../todos/{id}`.
- Frontend: aba "Arquivados" no `ProjectTodoPanel`, botões Arquivar/Restaurar/Eliminar (com confirmação).
- Testado ao vivo via API e com testes automatizados (Go + Vitest).

## Sobre a colisão com o self-evolution

Este repositório tem um self-evolution ativo rodando **durante toda a sessão**, que absorve trabalho não commitado em commits de snapshot próprios (`"Wharnex host snapshot before integration"`) sempre que faz sua própria integração. Em pelo menos uma ocasião, ele **reverteu** uma das minhas edições (`WorkspaceSideRail.tsx`, a conversão para lazy-loading) silenciosamente antes que eu conseguisse commitar — precisei reaplicar e commitar mais rápido da segunda vez. Recomendo à próxima sessão: commitar cada mudança imediatamente após validá-la, e sempre conferir `git log`/`grep` no arquivo logo depois de qualquer intervalo de tempo (build, teste demorado) para confirmar que o trabalho ainda está lá.

## Recomendação para a próxima sessão

1. Rodar o teste de isolamento por concorrência (1 worker / 1 supervisor) que ficou pendente — é o experimento mais informativo ainda não feito.
2. Se o crash sumir com concorrência mínima, subir a concorrência gradualmente até reproduzir, para achar o limiar real.
3. Se o crash **persistir mesmo com 1 worker / 1 supervisor**, o problema é meramente estrutural (algo que roda incondicionalmente no boot, não relacionado a Workers do ChatGPT) — nesse caso, focar em instrumentar o `app.whenReady()` do `main.mjs` com `console.log` de uso de memória (`process.memoryUsage()`) a cada segundo nos primeiros 60s de boot, para achar a janela exata onde a memória explode e correlacionar com o que está nos logs naquele instante.
4. Considerar pedir ao usuário para abrir o DevTools do processo renderer especificamente (não só o painel Network) e capturar uma Memory Heap Snapshot nos primeiros segundos de um restart, comparando dois snapshots consecutivos (5s de intervalo) para ver exatamente qual tipo de objeto está crescendo.
