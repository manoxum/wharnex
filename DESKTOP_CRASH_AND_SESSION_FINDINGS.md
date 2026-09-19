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

## RESOLVIDO — TODO_CLASSIFY estagnava porque o ChatGPT mudou o controlo de esforço

### Sintoma

`TODO_CLASSIFY`: 61 FAILED / 8 DONE antes desta correção. O modo de falha
**vivo** (17+ ocorrências, incluindo durante esta própria sessão) era:

```
ChatGPT did not provide whx_todo_classification_res_cat_<id>.zip
before the TODO classification timeout
```

sempre precedido, no log, por:

```
[chatgpt-effort] could not reach instant, submitting at whatever level
ChatGPT is currently on instead: ChatGPT reasoning effort did not reach
instant after bounded cycling (high -> high -> high -> high)
```

### Diagnóstico ao vivo (scraping direto via CDP)

A hipótese anterior (background-throttling do Worker escondido) foi
verificada e **descartada de vez**: os Workers são criados com
`setBackgroundThrottling(false)` e o poller nem os percorre. Em vez disso,
liguei o Electron diretamente com `--remote-debugging-port` (reaproveitando o
backend/frontend já em execução via `WHARNESS_SERVICES_MODE=stack`) e usei o
Chrome DevTools Protocol para observar o composer do Worker exatamente no
momento em que tentava mudar o nível de raciocínio:

1. Um `Input.dispatchKeyEvent` real (Ctrl+Shift+M, o atalho que o código
   assumia) chega à página — confirmado, não é um problema de foco/viewport —
   e **não faz nada**. O rótulo do botão do composer manteve-se em "Elevada"
   em todas as tentativas.
2. Abrindo o menu do composer com um clique real via CDP, o `outerHTML`
   revelou que o controlo **deixou de ser um menu de três opções cicladas por
   atalho** e passou a ser um **slider ARIA genuíno**
   (`role="slider"`, `aria-valuenow`/`aria-valuemax`, "3 de 3", com
   `aria-keyshortcuts="ArrowLeft ArrowRight"`).
3. Focando esse elemento (`slider.focus()`) e enviando `ArrowLeft` via CDP, o
   `aria-valuenow` desceu de forma determinística `2 → 1 → 0` — prova direta e
   reproduzível do mecanismo correto.

Achado adicional: `chat-agent-behavior.mjs` já tinha `effortSlider:
['[role="menuitem"][aria-keyshortcuts]']` documentado com o comentário "The
effort control is a slider driven by arrow keys" — uma tentativa anterior
(provavelmente do próprio self-evolution) já tinha identificado a mudança de
UI mas nunca ligou essa observação ao código de ciclagem, que continuava a
disparar Ctrl+Shift+M. O selector também apontava ao wrapper `role="menuitem"`
em vez do `role="slider"` real lá dentro.

### Correção

- `chat-agent-behavior.mjs`: `effortSlider` agora aponta ao elemento
  `role="slider"` real.
- `chat-agent-scripts.mjs`: novo `reasoningEffortAdjustScript` — localiza o
  botão do picker ou, se já aberto, o slider; só observa e prepara (foca,
  nunca clica), conforme a regra do ADR-0037 ("scripts observe and stage,
  they never click").
- `main.mjs`: nova `stepChatGPTReasoningEffortToward` substitui o
  `dispatchChatGPTEffortCycle` morto — abre o menu com um clique nativo
  confiável quando necessário, avança o slider exatamente um `ArrowLeft`/
  `ArrowRight` nativo na direção certa (calculada pela posição ordinal dos
  dois níveis, não por uma rotação fixa) e fecha o menu outra vez, para que a
  próxima leitura veja o rótulo recolhido em vez do título genérico do menu
  aberto. Reutiliza o `dispatchChatGPTAccountKey` já existente (já aceitava
  qualquer tecla só-letras) em vez de criar um novo dispatcher.
- Mantém a correção já aplicada nesta sessão de chamar
  `ensureChatGPTLayoutViewport` em `targetChatGPTComposer`: um viewport real
  (não 0×0) é pré-condição para qualquer evento nativo aterrar, em Worker ou
  em Supervisor escondido.

Testes: 412/412 no `desktop-check`, incluindo um novo teste dedicado que
verifica a wiring completa (script → main.mjs → seletor) e a ausência do
mecanismo antigo.

### Verificação ao vivo — mecanismo confirmado, ponta-a-ponta bloqueada pelo rate-limit

O mecanismo está provado de forma direta e reproduzível (a manipulação CDP do
slider, acima). A confirmação end-to-end de uma tarefa `TODO_CLASSIFY`
completa a correr sob o código novo, num arranque limpo, esbarrou no próprio
**rate-limit gate da conta** — `ChatGPT rate-limit gate is active` /
`ChatGPT rate-limit cooldown is active`, confirmado em `last_error` de tarefas
recentes — provocado pelo volume de tráfego desta própria investigação
(múltiplos restarts, reclassificações manuais, sondagens CDP repetidas). O
sistema reagiu **corretamente**: os workers pararam de reivindicar trabalho em
vez de continuar a bater na conta, exatamente como o `AGENTS.md` §8 exige.
Falta uma corrida limpa depois de a suspensão (até 30 min) expirar para fechar
o ciclo por completo, mas a causa raiz já não é hipótese — está provada ao
nível do mecanismo.

---

## RESOLVIDO — download não reconhecido vazava para o sistema operativo

### Sintoma

O ponto #1 do pedido do utilizador: "os worker estão a deixar o download
vazar em vez de capturar os zips". No `will-download` do Electron, todo
recognizer (bundle Wharnex, tradução, classificação de TODO, plano do
orquestrador, plano legado) podia recusar — e nesse caso o código terminava
num `return` nu, entregando o download ao comportamento por omissão do
Chromium **na própria partição de automação**. Um artefacto de Worker cujo
nome não batesse certo caía silenciosamente na pasta Downloads do operador em
vez de ser capturado, e um nome colidente disparava o diálogo nativo "Guardar
Como" do sistema operativo — modal, e é isso que trava o desktop inteiro até
ser fechado à mão.

### Correção

`chatGPTDownloadIsHumanBrowsing(sourceWebContents)` distingue a janela de
navegação humana ProjectScoped (que partilha a partição mas deve manter
comportamento de download normal) de tudo o resto, que é automação Wharnex.
O caminho passa a falhar fechado: cancela o download e regista um diagnóstico
com nome do ficheiro, MIME e origem, em vez de cair no comportamento por
omissão do Chromium.

Teste de regressão em `main-regression.test.mjs` cobre a ordem exata
(isenção antes do cancelamento, cancelamento depois de todo recognizer ter
recusado). Commit `6619270`.

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
sem a mensagem que o explica. Também foi o próprio self-evolution que resolveu
o piso do painel central desta sessão anterior, entre a documentação de uma
sessão e a seguinte (`3b75829 fix(workbench): favor centre in default
three-panel layout`, `8fe8b0f fix(workbench): remove false side-panel resize
ceiling`) — confirmado por inspeção, não repetido aqui. Para a próxima sessão:
commitar imediatamente após validar, e conferir `git log` a seguir a qualquer
intervalo longo (build, suite de testes).

## Recomendação para a próxima sessão

1. Confirmar `TODO_CLASSIFY` ponta-a-ponta depois de o rate-limit gate da
   conta expirar (até 30 min desde ~10:05-10:08 UTC de 2026-09-19): disparar
   `POST /api/sessions/{id}/todos/{todo_id}/classify` num TODO aberto e
   confirmar `classification_status: done` sem passar pelo caminho de
   tolerância a falha (procurar `[chatgpt-effort] key=... target=instant
   changed=true` no log, não `unconfirmed(wanted instant)`).
2. Evitar gerar rajadas de tráfego real contra a conta durante investigação —
   preferir uma única tarefa observada de perto em vez de disparar
   reclassificações repetidas, e lembrar que cada `make restart`/arranque do
   desktop volta a enfileirar todo TODO aberto sem classificação bem-sucedida
   de uma vez.
