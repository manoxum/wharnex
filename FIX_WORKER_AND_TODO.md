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
