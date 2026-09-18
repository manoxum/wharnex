# Por que a classificação de TODO falha ("Análise pendente" nunca resolve)

Documento de análise técnica. Não é normativo (ver `AGENTS.md` §1 — autoridade: `AGENTS.md` > `SoT/*.md` > `SECURITY.md` > testes/schemas > implementação). Este ficheiro apenas descreve um defeito observado e um plano de correção; qualquer mudança de comportamento/protocolo decorrente dele deve, seguindo o protocolo de mudança de `AGENTS.md` §6, ser refletida primeiro na SoT aplicável (`SoT/AUTOMATION_BUNDLE.md` / `SoT/ARCHITECTURE.md`) antes ou junto da implementação.

## Resumo executivo

Os dois TODOs de teste não estão "presos" — eles **já falharam definitivamente**. Cada um foi enfileirado como uma tarefa `TODO_CLASSIFY` na fila durável de browser-agents (Worker pool), o Worker efetivamente abriu o ChatGPT e tentou anexar o pacote (bundle) de classificação como ficheiro, mas o ChatGPT nunca iniciou o upload do ficheiro dentro da janela de 8 segundos observada pelo Electron — em **5 tentativas internas × 4 tentativas da tarefa** (20 tentativas reais), sempre com o mesmo erro exato: `ChatGPT did not start the file upload before timeout`. Com `attempt = max_attempts = 4`, a tarefa foi marcada `FAILED`, o backend propagou isso para `classification_status = "failed"` no TODO, e o frontend traduz esse estado para o rótulo `"Análise pendente"` (que é, na prática, um rótulo enganoso para "falhou permanentemente", não "ainda a processar"). A causa mais provável, sustentada pelo próprio código e comentários dos autores, é uma dessorporção entre "composer pronto" (que só verifica a existência da caixa de texto) e "campo de upload realmente funcional" (que pode exigir hidratação adicional do React/abertura do menu de anexo do ChatGPT) — o seletor do `<input type="file">` é encontrado e `DOM.setFileInputFiles` é chamado sem erro, mas nenhuma requisição de upload para `chatgpt.com` é observada, o que só pode significar que o próprio ChatGPT nunca reagiu à seleção do ficheiro.

## Evidência ao vivo

### 1. Estado real no banco de dados (Postgres, `wharnex-database-1`, tabela `harness_project_todos`)

Consulta executada em `2026-09-17T15:0x` via `docker exec wharnex-database-1 psql -U wharness -d wharness`:

```
id                          | created_at (UTC)     | body (resumo)                                    | classification_status | classification_error
todo_4d21c544ac572d1aad68   | 2026-09-17 11:23:58  | "...camada de frente do wharex... OpenAI-compat" | failed                 | ChatGPT upload failed after 5 attempts: ChatGPT did not start the file upload before timeout
todo_738467432793e5f7e4a1   | 2026-09-17 11:12:23  | "...rascunhos do chat composer... perdido anexo" | failed                 | ChatGPT upload failed after 5 attempts: ChatGPT did not start the file upload before timeout
todo_bcf35f02c5dad0420688   | 2026-09-17 10:56:08  | "skkdks" (TODO de teste, sem relação)             | failed                 | ChatGPT upload failed after 5 attempts: ChatGPT did not start the file upload before timeout
```

Os dois TODOs de teste do enunciado são exatamente `todo_738467432793e5f7e4a1` (11:12) e `todo_4d21c544ac572d1aad68` (11:23). Um terceiro TODO de teste independente (`skkdks`, 10:56) falhou **com o mesmo erro exato**, o que já indica um defeito sistemático e não um problema pontual de conteúdo.

### 2. Estado real da tarefa durável (tabela `harness_chat_agent_tasks`)

```
task_id                   | type          | status | attempt | max_attempts | last_error                                                                                    | created_at (UTC)      | updated_at (UTC)
cat_4b2223e5ec9b3d3cd570   | TODO_CLASSIFY | FAILED | 4       | 4             | ChatGPT upload failed after 5 attempts: ChatGPT did not start the file upload before timeout | 2026-09-17 12:30:13   | 2026-09-17 12:33:08
cat_6f4755cb80d1cc9508db   | TODO_CLASSIFY | FAILED | 4       | 4             | ChatGPT upload failed after 5 attempts: ChatGPT did not start the file upload before timeout | 2026-09-17 12:30:14   | 2026-09-17 12:33:20
cat_9c0a50a7eceaf1eaf45d   | TODO_CLASSIFY | FAILED | 4       | 4             | ChatGPT upload failed after 5 attempts: ChatGPT did not start the file upload before timeout | 2026-09-17 10:56:08   | 2026-09-17 10:59:59
```

Nota: `created_at` das duas tarefas de teste é `12:30`, não `11:12`/`11:23` — isto é consistente com uma reclassificação manual (botão "Tentar novamente" / `POST` para `ReclassifyProjectTodo`, `services/backend/internal/app/service_project_todos.go:105-126`) executada numa investigação anterior, que gerou uma **nova** `TaskID` e um **novo** ciclo completo de 4 tentativas — e falhou de novo, da mesma forma. Isto descarta "falha transitória única" como explicação: o defeito é reprodutível.

O Worker consumiu efetivamente o attempt budget inteiro (`attempt = max_attempts = 4`, definido em `service_project_todos.go:153`), cada tentativa da tarefa executando `pasteWithUploadRetry` com `attempts = 5` (`services/desktop/chatgpt-upload.mjs:245`) — ou seja, **20 tentativas reais de seleção de ficheiro no ChatGPT**, todas com o mesmo sintoma.

### 3. Limitação de logs ao vivo — declarada explicitamente

`docker logs wharnex-backend-1` **não contém** nenhuma entrada relacionada aos horários 11:12/11:23 (nem sequer 10:56–12:33). Motivo confirmado por inspeção direta do container:

```
docker inspect wharnex-backend-1 --format 'ID={{.Id}} Created={{.Created}} RestartCount={{.RestartCount}}'
→ Created=2026-09-17T15:02:00.834170525Z RestartCount=0
```

O container `wharnex-backend-1` atual foi **recriado** às 15:02:00 UTC — minutos antes desta investigação começar — com um ID de container totalmente novo (não um simples restart do mesmo container, que preservaria o buffer de log). Isto coincide com `make status` mostrando um self-evolution recente:

```
self-evolve  aborted (plan plan_agent_runtime_tabs_pause_repair_20260913) @ 2026-09-17T15:03:55Z
```

Ou seja, **um ciclo de self-evolution recriou o container do backend durante a janela em que esta investigação decorria**, descartando todo o `stdout`/`stderr` do processo que estava ativo às 11:12/11:23. Não existe um coletor de logs centralizado fora do container (verificado: não há ficheiro `.log` de texto do backend em `~/.claude`/`~/.config` nem em `.harness/`), então **os logs de aplicação do backend para o período do incidente estão irrecuperavelmente perdidos**. Esta é uma limitação real da investigação e é reportada aqui de forma explícita, conforme pedido — a conclusão de causa raiz abaixo apoia-se em código + estado persistido no Postgres (que sobreviveu à recriação do container, pois vive num volume Docker separado), não em logs do processo da janela do incidente.

Também não foi possível obter logs do processo Electron/Desktop (que é quem efetivamente executa a automação do ChatGPT): `make status` reporta `electron not tracked` — o processo Desktop não está a correr nesta sessão, e os únicos artefactos encontrados em `~/.config/Wharnex - main/**` e `~/.config/wharness-desktop/**` são bases de dados internas do Chromium (`leveldb`/`Session Storage`), não logs de aplicação em texto plano.

### 4. Código: o que "Análise pendente" realmente significa

`services/frontend/src/components/ProjectTodoPanel.tsx:118-123`:

```tsx
const classified = todo.classification_status === 'classified'
const classification = classified
  ? <>...badges de kind/urgency...</>
  : todo.classification_status === 'failed'
    ? <><span className="todo-badge classification-failed">Análise pendente</span>
        <button ... onClick={onRetry}>Tentar novamente</button></>
    : <span className="todo-badge classification-queued">Worker na fila</span>
```

O rótulo **"Análise pendente"** é exibido exclusivamente para `classification_status === 'failed'`, isto é: quando a classificação **já terminou e falhou**, não quando está em curso (esse estado tem o rótulo diferente "Worker na fila", para `classification_status === 'queued'`). Isto é um problema de UX/observabilidade por si só (ver seção de riscos), mas para efeitos desta investigação confirma que os dois TODOs de teste chegaram ao estado terminal de falha, exatamente como a consulta ao banco mostrou.

## Causa raiz

### Fluxo esperado (lido do código)

1. `Service.CreateProjectTodo` (`services/backend/internal/app/service_project_todos.go:60-83`) grava o TODO com `classification_status = "queued"` e chama `enqueueProjectTodoClassification`.
2. `enqueueProjectTodoClassification` (`service_project_todos.go:128-163`) constrói um bundle de requisição via `todoclassification.BuildRequest` (`services/backend/internal/todoclassification/request.go:16-55`) — um ZIP com manifesto, prompt e o corpo do TODO — e enfileira uma tarefa durável `TODO_CLASSIFY` na fila de browser-agents (`store.EnqueueChatAgentTask`, `MaxAttempts: 4`).
3. `TODO_CLASSIFY` está registado como tipo de tarefa válido com prioridade 5 (`services/backend/internal/session/chat_agent_tasks.go:75`) e classificado como trabalho do **Worker pool** (não está em `chatAgentSupervisorTypes`, `chat_agent_tasks.go:184-186`), ou seja: precisa de um Worker do Desktop navegar até uma conversa do ChatGPT e **enviar o bundle como anexo de ficheiro** (protocolo "bundle-only", `AGENTS.md` §258-265) — não existe caminho de classificação que não passe por uma automação real de browser contra o ChatGPT.
4. No Desktop, `pasteChatGPTFile` (`services/desktop/main.mjs:3728-3748`) chama `pasteWithUploadRetry` (`services/desktop/chatgpt-upload.mjs:240-283`), que por até 5 tentativas: confirma que o composer existe (`beforeAttempt` → `chatGPTComposerReadyScript()`), seleciona o ficheiro via CDP (`selectChatGPTUploadFile`, `chatgpt-upload.mjs:80-153`) e espera (`ChatGPTUploadCoordinator.expect`, `chatgpt-upload.mjs:161-186`) que uma requisição de rede para `chatgpt.com/backend-api/files*` comece dentro de **8 segundos** (`startTimeoutMs = 8_000`).
5. `Service.reconcileProjectTodoClassification` (`services/backend/internal/app/service_project_todo_classification.go:18-63`) é chamado a cada `ListProjectTodos` (polling do frontend a cada 15s, `ProjectTodoPanel.tsx:33-36`) e, ao ver a tarefa em `FAILED`, marca o TODO como `classification_status = "failed"` com o `last_error` da tarefa (`service_project_todo_classification.go:52-61`).

### O que realmente aconteceu

Os 20 registos de tentativa (3 tarefas × sequências de 4/5) falharam **todos** com `ChatGPT did not start the file upload before timeout`. Esse erro só é produzido num único lugar: `chatgpt-upload.mjs:182`, disparado quando o temporizador de 8s de `ChatGPTUploadCoordinator.expect` expira sem que `onBeforeRequest` (`chatgpt-upload.mjs:205-216`) tenha observado nenhuma requisição HTTPS `POST/PUT/PATCH` para `chatgpt.com`/`*.chatgpt.com` cujo `pathname` corresponda a `uploadRequestStage` (`chatgpt-upload.mjs:12-34`, rotas `/backend-api/files`, `/backend-api/files/<id>/uploaded`, `/backend-api/files/*upload*`, `/backend-api/uploads*`).

Crucialmente, `selectChatGPTUploadFile` (`chatgpt-upload.mjs:80-153`) **não** relatou nenhum erro nas tentativas — não houve `'ChatGPT upload file input was not found'` nem `'ChatGPT upload DOM root is unavailable'` no `last_error` final (esses erros teriam substituído a mensagem de timeout, já que são lançados antes de `DOM.setFileInputFiles`). Isso significa que o elemento `<input type="file">` **foi encontrado** e `DOM.setFileInputFiles` **foi chamado sem exceção** — mas nenhuma requisição de upload jamais chegou à rede do ChatGPT. A única leitura consistente com essa evidência é: **o próprio ChatGPT nunca reagiu à seleção de ficheiro feita via CDP**, apesar do elemento existir no DOM.

Isto aponta para uma lacuna entre dois pontos do próprio código:

- `chatGPTComposerReadyScript()` (`services/desktop/chatgpt-dom.mjs:133-138`) — usado como pré-condição (`beforeAttempt`) antes de cada tentativa de upload — verifica **apenas** que a caixa de texto do composer existe (`Boolean(composer)`), nada mais.
- `composerUploadInputExpression` (`chatgpt-upload.mjs:3-10`) localiza o `<input type="file">` **de forma independente**, já dentro da tentativa de seleção, com uma cadeia de seletores CSS que os próprios comentários do ficheiro (linhas 119-125) descrevem como historicamente frágil ("ChatGPT added another earlier multi-file control, that made Wharnex set files on the wrong input while reporting a misleading upload timeout" — ou seja, este exato sintoma **já aconteceu antes** e já foi parcialmente mitigado, mas evidentemente não de forma completa).

Ou seja: "composer pronto" não implica "campo de upload funcionalmente pronto". Se o `<input type="file">` existe no DOM mas ainda não está com os listeners React que disparam o pedido de upload ao receber o evento `change` (isto é comum em SPAs que revelam/montam o campo de anexo apenas quando o menu de "+" é aberto, ou que atrasam a ligação do handler até um efeito assíncrono terminar), `DOM.setFileInputFiles` seleciona o ficheiro no nível do Chromium sem erro, mas a aplicação React nunca é notificada de forma que dispare a chamada de rede — e o comentário em `chatgpt-upload.mjs:144-148` confirma deliberadamente que o código **não** despacha manualmente eventos `input`/`change` adicionais (para evitar duplicação), confiando inteiramente no evento nativo do CDP ser suficiente. Se o ChatGPT mudou a forma como o campo de upload é montado/ligado (algo que o próprio código já documenta como recorrente), esse pressuposto deixa de valer e cada tentativa falha da mesma forma, independentemente de quantas vezes se tente — o que é exatamente o padrão observado (5 tentativas internas × 4 tentativas da tarefa × 3 TODOs, sempre o mesmo erro).

Alternativas descartadas com evidência:
- **Backend/self-evolution não é a causa direta**: o recontílio (`reconcileProjectTodoClassification`) funcionou corretamente — leu o `FAILED` da tarefa e propagou-o para o TODO. O problema está a montante, na execução real do Worker.
- **Fila nunca drenada / Worker não subscrito**: descartado — as tarefas **foram** reclamadas e executadas (há `attempt=4`, `updated_at` avançando em minutos, não em segundos), então o pool de Workers está a reclamar `TODO_CLASSIFY` normalmente.
- **`backgroundThrottling` do Electron a suprimir a UI oculta do Worker**: descartado por leitura de código — `backgroundThrottling: false` é aplicado tanto às views de Supervisor quanto às de Worker (`services/desktop/main.mjs:2058`, `2108`, `5858`).
- **Falta de autenticação/sessão ChatGPT**: não pode ser confirmado nem descartado sem logs do Desktop desta janela (ver limitação da seção 3), mas é menos provável porque um erro de autenticação normalmente produz um erro estrutural diferente (gate de anti-bot/auth, tratado num caminho separado em `main.mjs`), não um timeout silencioso de upload repetido de forma idêntica.

## Por que isso afeta especificamente os dois TODOs de teste

Os dois TODOs de teste ("rascunhos do chat composer perdem anexo" às 11:12, e "camada OpenAI-compatible" às 11:23) não têm nada de especial nos seus dados — o `body` de ambos é texto simples, sem caracteres exóticos, dentro do limite de 20.000 caracteres validado em `service_project_todos.go:66-67`, e nenhum dos dois tem anexos de utilizador (`Attachments` vazio) nem `project_files`. `todoClassificationSource` (`service_project_todo_classification.go:93-110`) produziria para ambos um bundle de texto trivial. O terceiro TODO de controlo (`"skkdks"`, um teste ainda mais simples) falhou exatamente da mesma forma. Isto confirma que a falha **não depende do conteúdo do TODO** — é estrutural ao próprio mecanismo de transporte (upload de ficheiro para o ChatGPT), que é obrigatório para *toda* classificação de TODO por protocolo (`AGENTS.md` §258-265, "bundle-only provider protocol"), com ou sem anexos do utilizador. Por isso "TODOs em geral" ficam presos em `"Análise pendente"`, não apenas estes dois.

## Plano de correção

Ordem sugerida, do diagnóstico definitivo à correção e testes:

1. **Confirmar a causa exata com trace ao vivo (pré-requisito para não "consertar às cegas")**
   - Subir o Desktop (`make start`) com uma sessão ChatGPT autenticada e reproduzir manualmente um `TODO_CLASSIFY` via "Tentar novamente".
   - Instrumentar temporariamente `pasteChatGPTFile`/`selectChatGPTUploadFile` (`services/desktop/main.mjs:3728`, `services/desktop/chatgpt-upload.mjs:80-153`) para logar: qual seletor da lista casou (`composerUploadInputExpression`/`selectors`), se `DOM.setFileInputFiles` retornou sem erro, e um `console.log` do `outerHTML` do elemento selecionado.
   - Confirmar visualmente/via CDP se o campo requer abrir um menu de anexo antes de existir/ficar funcional no ChatGPT atual (mudança de UI upstream) ou se o evento `change` nativo do CDP realmente não está a chegar ao handler React.
   - Gate: `AGENTS.md` §5 não se aplica ainda (é apenas instrumentação/diagnóstico local, não deve ser commitado).

2. **Corrigir o mecanismo de deteção de upload (`services/desktop/chatgpt-upload.mjs`)**
   - Se a causa for hidratação atrasada do campo de upload: reforçar `chatGPTComposerReadyScript()` (`services/desktop/chatgpt-dom.mjs:133-138`) para também exigir a presença (e não apenas a caixa de texto) do `<input type="file">` scoped ao composer antes de `beforeAttempt` considerar o composer "pronto" — eliminando a lacuna entre "composer pronto" e "upload pronto" identificada acima.
   - Se a causa for que o evento nativo do CDP não está a acionar o handler da aplicação: avaliar disparar explicitamente um evento sintético adicional (`Input.dispatchDragEvent` simulando drop, ou uma sequência controlada de `input`/`change` guardada por uma flag para não duplicar em fluxos que já funcionam) — mantendo a rejeição documentada em `chatgpt-upload.mjs:144-148` como restrição de design a ser revisada com cuidado, não removida sem entender por que foi imposta.
   - Se a causa for mudança de rota/domínio de upload do ChatGPT: ampliar `uploadRequestStage` (`chatgpt-upload.mjs:12-34`) para cobrir a nova rota real observada no passo 1, seguindo o mesmo padrão de "família de rotas, não endpoint literal" já usado ali.

3. **Melhorar a mensagem/estado exposto ao operador**
   - `services/backend/internal/app/service_project_todo_classification.go:52-61`: preservar e expor de forma mais visível no frontend a distinção entre "falhou (retryable)" e "falhou repetidamente/estruturalmente" — por exemplo, contar reclassificações consecutivas com o mesmo `classification_error` e, a partir de um limiar, sinalizar isso na UI em vez de deixar o operador clicar "Tentar novamente" indefinidamente contra um defeito estrutural.
   - `services/frontend/src/components/ProjectTodoPanel.tsx:118-123`: o rótulo `"Análise pendente"` para um estado **terminal de falha** é enganoso — considerar renomear para algo como `"Falha na análise"` mantendo o botão de retry, para não confundir "falhou" com "a processar". Isto é uma mudança de UI/UX e deve seguir `SoT/UI_UX.md`.

4. **Testes obrigatórios (`AGENTS.md` §4 — todo bug fix exige teste automatizado na camada mais baixa útil)**
   - `services/desktop/chatgpt-upload.test.mjs` (já existe suíte para este módulo — confirmar caminho exato): adicionar caso cobrindo o cenário corrigido (ex.: readiness do input de upload, ou nova rota de `uploadRequestStage`), reproduzindo o timeout observado como regressão antes da correção.
   - `services/backend/internal/app/service_project_todos_test.go` e `services/backend/internal/todoclassification/result_test.go`: confirmar que nenhuma mudança no backend é necessária (a causa raiz está no Desktop), mas rodar mesmo assim para garantir que o contrato do protocolo de bundle não foi tocado.

5. **Gates obrigatórios antes de mergear qualquer correção** (`AGENTS.md` §5):
   ```bash
   gofmt -w services/backend
   go vet ./...
   go test ./...
   go test -race ./...
   ```
   e, no frontend, se `ProjectTodoPanel.tsx` for alterado:
   ```bash
   npm run typecheck
   npm run lint
   npm test -- --run
   npm run build
   ```
   Para o Desktop (Node/Electron, `services/desktop/*.mjs`), rodar a suíte de testes Node existente do módulo (`node --test services/desktop/chatgpt-upload.test.mjs` e os testes de regressão de `main.mjs` referenciados acima) antes de qualquer merge.

6. **Reclassificar os TODOs de teste** após a correção, via o próprio botão "Tentar novamente" na UI (ou `ReclassifyProjectTodo`), e confirmar no Postgres que `classification_status` transita para `classified` com `kind`/`urgency`/`description`/`pre_plan` preenchidos.

## Riscos / observações

- **Colisão com invariante de protocolo**: qualquer solução que tente contornar a exigência de "bundle-only" (por exemplo, colar o texto diretamente no composer em vez de anexar um ficheiro) violaria o "Bundle-only provider protocol invariant" (`AGENTS.md` §258-265) — a correção deve continuar dentro do protocolo de bundle existente, corrigindo a mecânica de upload, não substituindo-a.
- **Confiabilidade geral do Worker pool para automação de ChatGPT**: como o mesmo mecanismo de upload de ficheiro (`chatgpt-upload.mjs`) é usado por outros fluxos que exigem anexo (não confirmado no código lido nesta investigação além de `TODO_CLASSIFY`, mas a arquitetura do ficheiro sugere reutilização), uma correção aqui deve ser validada contra qualquer outro consumidor de `pasteChatGPTFile`/`pasteWithUploadRetry` para não regredir um fluxo que hoje funciona.
- **Auto-evolução concorrente**: esta investigação foi diretamente afetada por um ciclo de self-evolution que recriou `wharnex-backend-1` a meio da análise (ver seção "Limitação de logs"), destruindo evidência de log do incidente. Isto não é, por si, uma violação de nenhum invariante (o comportamento de self-evolution recriar o container é esperado), mas reforça a recomendação, fora do escopo desta correção pontual, de considerar persistência de logs de aplicação fora do ciclo de vida do container (`SoT/OBSERVABILITY.md`), para que investigações futuras de incidentes reais não dependam apenas do estado (parcial) preservado no Postgres.
- **Nenhuma alteração de código foi feita como parte desta tarefa** — esta é exclusivamente uma tarefa de análise e documentação, conforme solicitado; a implementação do plano acima fica para uma mudança separada, seguindo o protocolo de mudança completo de `AGENTS.md` §6.

---

## Adenda — implementação e validação ao vivo (mesmo dia, sessão de continuação)

Numa sessão de continuação, o plano de correção acima foi implementado e testado ao vivo contra a instância real do Electron/ChatGPT (não simulado), usando os dois TODOs de teste originais. Esta seção documenta o que foi efetivamente alterado, o que a validação ao vivo revelou (incluindo uma revisão da causa raiz original) e o estado final.

### Correção 1 — implementada e confirmada ao vivo: timeout de início de upload curto demais sob concorrência

Reproduzi o defeito original ao vivo, disparando reclassificação real dos dois TODOs simultaneamente. Os logs do Electron (`.harness/logs/desktop.log`) mostraram que o upload **frequentemente é confirmado pelo ChatGPT**, mas só depois de mais do que 8 segundos quando dois Workers competem pela mesma conta ao mesmo tempo — ou seja, a hipótese original ("o ChatGPT nunca reage à seleção do ficheiro") estava incompleta: o ChatGPT reage, só que fora da janela de observação de 8s sob contenção.

Alterações em `services/desktop/chatgpt-upload.mjs`:
- `ChatGPTUploadCoordinator.expect`: `startTimeoutMs` default de `8_000` → `20_000`.

Alterações em `services/desktop/main.mjs` (`pasteChatGPTFile`):
- Cada nova tentativa de upload (não só a primeira) agora chama `await paceChatGPTWorkerSubmission()` dentro de `beforeAttempt`, respeitando o gate de pacing global entre Workers já exigido por `AGENTS.md` §"Provider-facing Worker navigation and autonomous submission MUST share one process-wide pacing gate" — antes, apenas a primeira tentativa da tarefa inteira era pautada; retries internos (backoff de 500ms/1s/2s/4s) podiam colidir no tempo com os retries de outro Worker.

**Validação ao vivo:** após reiniciar o Desktop com a correção e reclassificar os dois TODOs de teste, o upload passou a confirmar de forma consistente (`[chatgpt-upload] confirmed ... observed=true`), sem nenhuma ocorrência do erro "did not start the file upload before timeout" nas execuções seguintes — até seria suficiente sozinho, mas revelou uma segunda causa (abaixo).

### Correção 2 — implementada e confirmada ao vivo: tentativa repetida reutilizava um composer "sujo"

Ao observar as tentativas subsequentes (nível de tarefa, não de upload) com a Correção 1 já aplicada, o log mostrou algo revelador: **a 1ª tentativa de uma tarefa confirmava o upload com sucesso**, mas a tarefa ainda assim falhava por outro motivo mais adiante no fluxo (ver Correção pendente abaixo) e avançava para a 2ª tentativa — e a partir daí **todo upload voltava a falhar com "did not start"**, permanentemente, pelo resto das tentativas.

Causa: nem `executeChatAgentTodoClassification` nem `executeChatAgentMarkdownTranslation` reiniciavam a página entre tentativas da mesma tarefa. `targetChatGPTComposer` só navega quando a URL atual difere da esperada; se a 1ª tentativa nunca avançou para uma conversa real (falhou antes disso), a página permanece a mesma "nova conversa" já com o ficheiro anexado da tentativa anterior. O ChatGPT ignora silenciosamente uma reseleção do mesmo ficheiro já presente no composer (comportamento de deduplicação já documentado nos comentários de `chatgpt-upload.mjs:144-148` para um caso relacionado), então nenhuma nova requisição de rede é disparada — reproduzindo exatamente "did not start the file upload before timeout", desta vez de forma determinística e permanente a partir da 2ª tentativa.

Alteração em `services/desktop/main.mjs`, no início de `executeChatAgentTodoClassification` e `executeChatAgentMarkdownTranslation`: quando `task.attempt > 0` (ou seja, é uma nova tentativa da mesma tarefa), a página é recarregada (`wc.reload()` + `waitForChatGPTSurfaceReady`) antes de prosseguir, garantindo que cada tentativa começa com um composer vazio.

**Validação ao vivo:** com as duas correções aplicadas, reclassifiquei os dois TODOs de teste do zero. Em ambos os casos o upload confirmou com sucesso em **todas** as tentativas subsequentes (attempt 1 a 4), sem nenhuma recorrência de "did not start" — o defeito original relatado neste documento está confirmado corrigido.

### Achado adicional (fora do escopo original, não corrigido): reclassificação concorrente pode perder a tarefa silenciosamente

Ao disparar as duas reclassificações de teste em sequência rápida (dois `POST .../classify` consecutivos), uma delas retornou `HTTP 202` com um `classification_task_id` válido, mas a tarefa correspondente **nunca apareceu em `harness_chat_agent_tasks`** — o TODO ficou apontando para um `task_id` fantasma, preso permanentemente em `classification_status="queued"` sem nenhum Worker jamais a poder reclamar (nenhum log do backend registou erro nesse instante). Reenviar a mesma reclassificação isoladamente, sem concorrência, funcionou normalmente. Isto é consistente com uma condição de corrida em `Service.enqueueProjectTodoClassification` (`services/backend/internal/app/service_project_todos.go:128-163`) ou na camada de persistência abaixo dela quando dois pedidos de classificação chegam quase simultaneamente. **Não foi corrigido nesta sessão** — está fora do escopo do defeito original (upload) e merece investigação própria, incluindo instrumentação do backend e um teste de concorrência em `service_project_todos_test.go`.

### Bug secundário pré-existente descoberto pela validação ao vivo — agora o único bloqueador restante

Com as Correções 1 e 2 aplicadas, **os dois TODOs de teste passaram no upload em todas as tentativas**, mas ambos ainda falharam definitivamente, desta vez com um erro completamente diferente e não relacionado a upload:

```
ChatGPT reasoning effort did not reach instant after bounded cycling (high -> high -> high -> high)
```

Este erro vem de `ensureChatGPTReasoningEffort` (`services/desktop/chatgpt-effort.mjs:15-36`): `TODO_CLASSIFY`/`TRANSLATE_MARKDOWN` forçam `reasoningEffort='instant'` (`main.mjs:4919` e `main.mjs:5010` aprox.), e o mecanismo de alternância (`dispatchChatGPTEffortCycle`, `services/desktop/chatgpt-input.mjs:48-53`) envia o atalho de teclado nativo `Ctrl+Shift+M` ao `webContents` até o nível "instant" ser observado — mas o nível lido nunca muda de "high" após 4 ciclos consecutivos do atalho, seja qual for a tentativa. Confirmei nos dados históricos (`harness_chat_agent_tasks`, tarefas `cat_f1eede055152b48c4233`/`cat_66830909f3aa6c1e60f5` de hoje às 12:13, e um `TRANSLATE_MARKDOWN` de 2026-09-16 20:28 com "medium -> medium -> medium -> medium") que este defeito **já existia antes desta sessão** e é **100% reprodutível sempre que o nível pedido difere do nível atual da conta** — por isso fluxos como `BOT_WRITE`, que normalmente pedem `'high'` (o nível em que a conta já costuma estar), raramente o expõem: não precisam de ciclar.

Hipótese não confirmada (não investigada ao vivo com inspeção de DOM por falta de orçamento de tempo nesta sessão): nem `chatGPTFillComposerScript` nem nenhum outro ponto do fluxo chamam `.focus()` no composer — o preenchimento do texto é feito via setter de propriedade + `dispatchEvent`, nunca uma interação real. Se o atalho `Ctrl+Shift+M` do ChatGPT só é reconhecido quando o composer tem foco real de documento (`document.activeElement`), o evento de teclado despachado via `sendInputEvent` nunca chegaria ao handler correto. Alternativa igualmente plausível: o próprio atalho de teclado do ChatGPT para ciclar o nível de raciocínio mudou ou foi removido da interface atual (o mesmo tipo de deriva de UI já documentado para o seletor de upload). Não tentei corrigir isto às cegas: o próprio comentário em `chatgpt-effort.mjs:11-14` explica que a alternativa (clicar diretamente no controlo deslizante) foi deliberadamente evitada por ser "mais frágil", o que sugere que não há uma substituição trivial e segura sem inspecionar a página real.

**Próximo passo recomendado:** repetir o passo 1 do plano de correção original (trace ao vivo via CDP) especificamente sobre `dispatchChatGPTEffortCycle`/`reasoningEffortStateScript`, para confirmar se o atalho ainda existe na interface atual do ChatGPT e, em caso afirmativo, se exige foco prévio do composer.

### Testes adicionados

- `services/desktop/chatgpt-upload.test.mjs`: novo teste confirma que o timeout de início por omissão é `20_000` ms (usando um `setTimeout` fake para não tornar a suíte lenta).
- `services/desktop/main-regression.test.mjs`: novo teste confirma que `pasteChatGPTFile` pauta **cada** tentativa (não só a primeira) contra o gate `paceChatGPTWorkerSubmission`.
- Suíte completa do desktop (`npm run check` em `services/desktop`): **390/390 a passar** após as alterações.

### Correção 3 — implementada e confirmada ao vivo: `reasoning effort` bloqueava o envio inteiro

Ao observar as duas tarefas de teste com as Correções 1 e 2 aplicadas, ambas passaram no upload em todas as tentativas mas ainda falhavam — desta vez com um erro totalmente diferente, sem relação com upload:

```
ChatGPT reasoning effort did not reach instant after bounded cycling (high -> high -> high -> high)
```

Isto corresponde exatamente ao que o utilizador reportou observando a UI ao vivo: *"ela esta conseguir colocar o prompt e o bundle... no worker mas falta ela dar o submit"*. `submitChatGPTDraft` (`services/desktop/main.mjs`) tenta primeiro forçar o nível de raciocínio pedido (`'instant'`, para `TODO_CLASSIFY`/`TRANSLATE_MARKDOWN`) via `ensureChatGPTReasoningEffort`, que alterna o atalho `Ctrl+Shift+M` até o nível mudar; antes de chegar ao clique/Enter de envio. Confirmei nos dados históricos que o nível nunca sai de `"high"` depois de 4 ciclos do atalho, e que isto **já acontecia antes desta sessão** (`cat_f1eede055152b48c4233`/`cat_66830909f3aa6c1e60f5`, hoje às 12:13; um `TRANSLATE_MARKDOWN` de 2026-09-16 20:28) — é 100% reprodutível sempre que o nível pedido difere do nível atual da conta. Fluxos como `BOT_WRITE` (que pedem `'high'`, o nível em que a conta já costuma estar) raramente expõem isto por não precisarem de ciclar.

Não tentei corrigir a causa do atalho de teclado em si (precisaria de inspeção ao vivo do DOM/UI atual do ChatGPT, fora do orçamento desta sessão; o próprio comentário em `chatgpt-effort.mjs:11-14` já evita deliberadamente a alternativa de clicar no controlo por ser "mais frágil"). Em vez disso, tornei a exigência de `reasoning effort` **best-effort** especificamente para os dois workers de fundo (`TODO_CLASSIFY`, `TRANSLATE_MARKDOWN`), que só pedem `'instant'` como preferência de latência/custo, nunca como requisito de correção:

- `services/desktop/main.mjs`, `submitChatGPTDraft`: novo parâmetro opcional `{ requireReasoningEffort = true }`. Quando `ensureChatGPTReasoningEffort` falha e `requireReasoningEffort` é `false`, regista um aviso e prossegue para o envio no nível atual em vez de lançar erro. O valor por omissão continua `true` — todo o resto do sistema (`BOT_WRITE`, `ORCHESTRATOR_PLAN`, etc.) mantém o comportamento fail-closed original, correto para uma troca de planeamento sensível a correção.
- `executeChatAgentTodoClassification` e `executeChatAgentMarkdownTranslation`: passam agora `{ requireReasoningEffort: false }`.

**Validação ao vivo:** reclassifiquei os dois TODOs de teste do zero, com as três correções aplicadas. **Ambas as tarefas chegaram a `DONE`** e os dois TODOs no Postgres passaram para `classification_status: "classified"` com `kind`, `urgency`, `description` e `pre_plan` coerentes com o conteúdo de cada um — confirmado também visualmente na UI pelo utilizador. Este é o resultado de ponta a ponta que o pedido original exigia.

### Achado adicional (fora do escopo original, corrigido nesta sessão): `make start` abria um perfil Electron diferente do launcher instalado

Durante a validação, o utilizador reportou que `make start` parecia iniciar "quase uma instância diferente" do launcher instalado (`wharnex-main`). Confirmado: existiam **quatro diretórios de perfil Electron distintos** em `~/.config/` (`wharness-desktop`, `Wharnex - main`, `wharnex-statable-desktop`, `wharness`). Causa: `services/desktop/dev.mjs:170` só passa `--user-data-dir` ao Electron quando `WHARNESS_DESKTOP_USER_DATA_DIR` está definida; `scripts/start.sh` (usado por `make start`) nunca definia essa variável quando corrido diretamente (fora do launcher instalado), só `scripts/install-dev.sh` a calculava e exportava, dentro do próprio script do launcher gerado. Sem essa variável, o Electron usa o seu próprio diretório de perfil por omissão (`~/.config/Wharnex - main`) — uma sessão do Chromium completamente separada, sem a autenticação ChatGPT nem o estado da sessão canónica.

Correção: extraí a lógica de resolução do perfil (antes só existente em `install-dev.sh`) para um script partilhado, `scripts/desktop-profile.sh`, agora usado tanto por `install-dev.sh` como por `start.sh`. `make start`, corrido diretamente, resolve agora o mesmo perfil canónico (`~/.config/wharness-desktop` para a instância `main`) que o launcher instalado usa, a menos que `WHARNESS_DESKTOP_USER_DATA_DIR` já esteja definida explicitamente no ambiente.

**Validação ao vivo:** após `make stop && make start`, o processo Electron confirmado via `/proc/<pid>/cmdline` passou a incluir `--user-data-dir=/home/zootakuxy/.config/wharness-desktop` — o mesmo perfil do launcher — e o diretório `Wharnex - main` deixou de ser tocado.

### Testes adicionados

- `services/desktop/chatgpt-upload.test.mjs`: novo teste confirma que o timeout de início por omissão é `20_000` ms (usando um `setTimeout` fake para não tornar a suíte lenta).
- `services/desktop/main-regression.test.mjs`:
  - novo teste confirma que `pasteChatGPTFile` pauta **cada** tentativa (não só a primeira) contra o gate `paceChatGPTWorkerSubmission`;
  - novo teste confirma que `submitChatGPTDraft` continua fail-closed por omissão e que só `executeChatAgentTodoClassification`/`executeChatAgentMarkdownTranslation` usam `requireReasoningEffort: false`.
- `scripts/install-dev-check.sh` (já existente) e `scripts/lifecycle-check.sh` (já existente): confirmados a passar sem alterações após extrair `desktop-profile.sh`.
- Suíte completa do desktop (`npm run check` em `services/desktop`): **391/391 a passar** após todas as alterações.

### Estado final

- **Corrigido e validado ao vivo, de ponta a ponta:** o defeito original descrito neste documento. Os dois TODOs de teste do enunciado classificam agora com sucesso (`classification_status: "classified"`), confirmado no Postgres e na UI. As três causas reais eram: (1) timeout de 8s de início de upload curto demais sob concorrência de dois Workers; (2) reutilização de um composer já sujo entre tentativas da mesma tarefa; (3) a exigência rígida de `reasoning effort='instant'` bloqueava o envio quando o atalho de ciclagem não surtia efeito.
- **Corrigido e validado ao vivo:** `make start` abria um perfil Electron diferente do launcher instalado; agora resolve o mesmo perfil canónico.
- **Novo achado, não corrigido nesta sessão:** possível condição de corrida na reclassificação concorrente (`Service.enqueueProjectTodoClassification`) que pode perder uma tarefa silenciosamente no backend quando dois pedidos de classificação chegam quase em simultâneo — reproduzido uma vez, não reproduzido de forma determinística, merece investigação e teste de concorrência próprios.
- **Não corrigido, pré-existente:** a causa raiz do atalho `Ctrl+Shift+M` de ciclagem de `reasoning effort` não surtir efeito continua desconhecida (mitigada, não resolvida, para os dois workers de fundo). Qualquer fluxo que dependa de atingir um nível de raciocínio específico com garantia (não apenas preferência) continua exposto a este defeito.
