# Achados — crash do desktop, performance do frontend e classificação de TODOs

Documento de análise técnica. Não é normativo (ver `AGENTS.md` §1 — autoridade: `AGENTS.md` > `SoT/*.md` > `SECURITY.md` > testes/schemas > implementação).

Sessões de 2026-09-18/19. A secção **Resolvido** descreve o que foi diagnosticado ao vivo e corrigido; a secção **Por resolver** é o que continua em aberto, com a evidência já paga.

---

## RESOLVIDO — o loop de crash/restart do renderer (`exitCode=133`)

### Sintoma

O renderer principal (`window=primary`) morria com
`render-process-gone reason=crashed exitCode=133` em 15-45 s de um arranque
limpo, **sem qualquer interação do utilizador**, e voltava a morrer depois de
cada reload. O budget de restarts não protegia: o temporizador de "renderer
saudável" (30 s) reposicionava o contador a zero antes de o limite ser
atingido, por isso o ciclo era **infinito**.

`exitCode=133` é `128 + SIGTRAP`: o `__builtin_trap()` que o V8 usa para um
CHECK falhado e para OOM do heap.

### Medição ao vivo

Amostragem por processo a 1 Hz durante o arranque:

```
up=0s   rss=263MB  cpu=107%
up=5s   rss=1789MB cpu=117%
up=12s  rss=4473MB cpu=119%
up=25s  rss=7537MB cpu=88%     -> morto pelo V8
```

~420 MB/s de alocação com a CPU cravada acima de 100% **desde o primeiro
segundo**. O CDP nem respondia: `Runtime.getHeapUsage` expirava aos 15 s
porque a main thread nunca cedia.

Interrompendo o V8 com `Debugger.pause` (funciona dentro de um loop síncrono),
a stack saiu **idêntica em duas amostras independentes**:

```
(anon)   index.js          <- o updater de setEvents
Ar       react             <- basicStateReducer: typeof s === 'function' ? s(t) : s
dd       react             <- updateReducerImpl: repete a fila de updates
Yc / useState / nS / od / kd / D_ / ng / Vy / Yd / eg / bg
```

### Causa raiz

Duas falhas que se multiplicam:

1. **`GET /api/sessions/{id}/events` (SSE) repetia todo o histórico da sessão
   na ligação, sem limite** — enquanto o endpoint REST irmão
   (`eventHistory`) já limitava a 2000. Medido numa sessão corrente deste
   repositório: **3159 frames / 4,7 MB numa rajada** a cada ligação, e há uma
   ligação nova a cada arranque do renderer (e a cada crash).

2. **O updater de `setEvents` não era puro.** Fazia, dentro da função passada
   ao `setState`:

   ```js
   const next = [...current, parsed].slice(-500)
   saveExecutionHistory(projectPath, chatId, next)   // filter + map + JSON.stringify + localStorage
   return next
   ```

   React trata os updaters como puros e **repete toda a fila do hook** em cada
   passagem de render. Com N frames em fila, o custo é quadrático em N, e cada
   invocação serializa até 500 eventos (~290 KB) e escreve em localStorage.
   Além disso o handler lia `loadWorkspaceChats(projectPath)` (JSON.parse de
   localStorage) **duas vezes por frame**.

3159 frames × ~290 KB só de serialização ≈ 920 MB de piso, multiplicado pela
repetição da fila → os GBs observados. É também a resposta às outras duas
perguntas da sessão: **o frontend estava "pesado e a bloquear o utilizador"** e
**o chat não mostrava skeleton nem carregamento progressivo** porque a main
thread nunca chegava a pintar.

### Não é regressão deste ramo

`connectEvents` em `main` é **byte-a-byte igual** à versão pré-correção, e o
handler SSE em `main` é igualmente ilimitado. O defeito sempre existiu; o que
mudou foi o **volume**: o chat ativo acumulou 3159 eventos durante a sessão
pesada de 18/09. É um bug dependente de carga, e por isso não aparecia antes.

### Correção

- `services/backend/.../httpapi/server.go`: o catch-up do SSE passa a partilhar
  a constante `maxHistoryEvents` com o endpoint REST. Verificado ao vivo:
  3159 frames / 4 735 528 B → **2000 frames / 2 791 506 B**.
- `services/frontend/src/lib/eventStream.ts` (novo): um coalescer que possui a
  deduplicação, a janela retida e a cadência de flush/persistência. Uma rajada
  de catch-up passa a ser **um flush e uma persistência**, não uma por frame.
- `services/frontend/src/App.tsx`: `connectEvents` encaminha cada frame para o
  coalescer; o estado passa a ser definido por valor (nunca por updater
  impuro); `loadWorkspaceChats` é lido uma vez por lote.

Testes: `src/lib/eventStream.test.ts` (5 casos, relógio controlado, prova que
3159 frames dão 1 flush + 1 persist), `src/App.eventStreamCoalescing.test.ts`
(a ligação em `App.tsx`), `httpapi/event_stream_test.go` (o limite do SSE).

### Verificação ao vivo

Antes: crash a cada ~25 s, em ciclo. Depois: **4+ minutos sem um único crash**,
cada renderer estável em 300-340 MB. Confirmado também pelo operador ("agora
sim, fino e fluido").

---

## RESOLVIDO — o painel central não podia ser encolhido

O piso estava espalhado por **cinco regras de CSS em três camadas** mais uma
constante em JS, e a última regra reimpunha o piso depois de as anteriores já
terem sido relaxadas:

| Local | Piso |
|---|---|
| `.agent-workspace` (regra inicial) | `minmax(390px, 43%)` |
| `.workspace-mode-surface > .agent-workspace` | `min-width: calc(100vw / 3)` |
| `.agent-workspace` (regra base) | `min-width: calc(100vw / 3)` |
| `.agent-workspace.agent-rail-unified` (última camada) | `minmax(480px,…) 6px minmax(400px,1fr)` = **886px** |
| `.workspace-right-drawer` | `flex: 0 0` (não encolhe) + `min-width: 360px` |
| `.workspace-side-drawer-right` | `min-width: 360px !important` |
| `WorkspaceSideRail.tsx` | `WORKSPACE_STACK_MIN_PX = 886` — o teto do arrasto reservava 886px ao centro |

Todos removidos ou relaxados. O centro reflui com `minmax(0, …)`; a reserva do
arrasto desceu para 240px, só para o painel não desaparecer.

**Novo padrão 25 / 50 / 25**: `defaultSidePanelWidth()` em
`lib/workbenchPreferences.ts` dá a cada painel lateral um quarto da largura
útil (viewport menos o rail e os dois splitters), deixando metade ao centro; o
teto de arrasto passou a ser relativo ao ecrã (`max(estático, 45% da
viewport)`), porque um teto fixo impedia um ecrã largo de chegar a esse quarto.
O operador pode redimensionar livremente a partir daí.

Testes atualizados/acrescentados em `src/styles.test.ts` e
`src/lib/workbenchPreferences.test.ts` — as asserções antigas fixavam
literalmente os pisos de 320px/480px/400px, e foram substituídas por asserções
que exigem a **ausência** de piso em cada camada.

---

## POR RESOLVER — TODO_CLASSIFY não conclui

### Estado

`TODO_CLASSIFY`: 52 FAILED / 7 DONE. O modo de falha **vivo** (17 ocorrências,
a mais recente durante esta sessão) é:

```
ChatGPT did not provide whx_todo_classification_res_cat_<id>.zip
before the TODO classification timeout
```

mais 13 × `lease expired after maximum attempts`. Os erros de upload e de
reasoning-effort são de 17/09 e já estavam corrigidos.

### Evidência recolhida

O diagnóstico `[diag-download]` (instrumentação já existente em
`chatGPTDownloadDiagnosticScript`) mostra, para uma tarefa, **81 sondagens
consecutivas com a mesma `data-message-id` e o mesmo DOM**:

- a mensagem do assistente mantém a classe `streaming-animation` **para
  sempre**;
- o texto visível fica congelado num prefixo do nome do ficheiro — `wh` numa
  tentativa, `whx_todo_classification_res_cat` noutra — e nunca avança;
- renderizado como `<a class="decorated-link" href="">`, sem
  `downloadSemantic`, sem `fileLike`, sem `download`;
- `decision: {index:-1}` — não há nenhum controlo de download no turno, porque
  a resposta nunca termina.

Ou seja: **não é o matcher de download que falha; é a geração que estagna**. A
tarefa espera os 4 minutos, expira e gasta uma tentativa.

### Hipótese investigada e descartada

Suspeitei de *background throttling* do Chromium no Worker escondido:
`chatGPTEntryNeedsSupervision` só conhecia `expectedChatGPTBundles` e ignorava
os três mapas irmãos (`expectedChatGPTTranslations`,
`expectedChatGPTTodoClassifications`, `expectedChatGPTOrchestratorPlans`), pelo
que uma expectativa armada desses três não mantinha o renderer a full speed.

Isso **é um defeito real e foi corrigido** (`chatGPTArtifactExpectationArmed` +
reconciliação do throttle ao armar/desarmar, com teste de regressão reforçado
em `main-regression.test.mjs`). **Mas não explica esta estagnação**: os Workers
são criados com `setBackgroundThrottling(false)` e o poller só percorre
`chatgptViews`, que não contém Workers — ou seja, já estavam a full speed. A
correção vale para Supervisors escondidos, não para este caso.

### Próximos passos sugeridos

1. Observar a conversa estagnada diretamente (abrir o Worker com **Seguir
   (flow)**, ou correr o Electron com `--remote-debugging-port` e inspecionar
   o `WebContentsView` do worker) para distinguir entre *tokens que não chegam
   pela rede* e *tokens que chegam mas não são pintados*. O painel Network do
   DevTools desse renderer responde a isto de forma definitiva.
2. Verificar se a estagnação correlaciona com `gpt-5-6-thinking`: o log mostra
   `[chatgpt-effort] could not reach instant … (high -> high -> high -> high)`
   — o seletor de esforço não responde ao clique sintético, exatamente como o
   `menu-not-open` dos `RENAME_CHAT`/`ARCHIVE_CHAT` (124/124 falhas). Se for a
   mesma deriva de seletor na UI do ChatGPT, resolve-se uma vez para os dois.
3. Independentemente da causa: uma resposta que fica `streaming-animation` sem
   avançar durante uma janela limitada devia ir para `ATTENTION` com essa
   evidência em vez de gastar os 4 minutos e uma tentativa — o padrão de
   "bound by evidence" que o `AGENTS.md` §8 já exige para `AWAIT_RESPONSE`.

---

## Suites de testes: estado real

Contagens medidas em worktrees limpas, para separar o que é deste trabalho do
que já vinha de trás:

| Árvore | Ficheiros a falhar | Testes a falhar |
|---|---|---|
| `main` (08b6bef) | 10 | 18 |
| ramo, antes deste trabalho (166c098) | 11 | 23 |
| ramo, depois deste trabalho | 10 | 22 |

`main` **não** está verde. As 5 falhas que o ramo acrescentou vieram de commits
anteriores desta linha (virtualização do chat, layout das gavetas); este
trabalho não acrescenta nenhuma e recupera `styles.test.ts`. Em corridas
completas em paralelo há 1-2 falhas adicionais intermitentes em
`ChatPanel`/`AgentWorkspace` que não se reproduzem em isolamento — partilham
globais de jsdom.

Continuam por resolver, e não são deste trabalho: `App.repairRecovery`,
`App.bundleRouting`, `App.chatSwitchLatency`, `App.approvalPendingNotice`,
`App.globalAttentionCenter`, `Inspector.conflictResolution`,
`workspaceMemory` (superfícies de conflito), `theme.test.ts`, e as restantes de
`ChatPanel`/`AgentWorkspace`.

---

## Colisão com o self-evolution

Continua ativo e continua a absorver trabalho não commitado em commits próprios
`"Wharnex host snapshot before integration"`. Nesta sessão absorveu as seis
alterações do coalescer (commit `45a409a`) e mais um lote (`8c8a8f5`) antes de
eu conseguir commitá-las com mensagem própria — o conteúdo está íntegro, mas
sem a mensagem que o explica. Para a próxima sessão: commitar imediatamente
após validar, e conferir `git log` a seguir a qualquer intervalo longo (build,
suite de testes).
