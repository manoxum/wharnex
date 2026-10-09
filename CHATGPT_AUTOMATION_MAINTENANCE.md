# Manutenção e aceitação da automação ChatGPT

Este documento descreve o contrato atualmente implementado para a automação do ChatGPT no Desktop, como investigar mudanças estruturais da página e como validar uma correção. Use-o quando uma atualização do ChatGPT quebrar uma operação, quando houver HTTP 429/“too many requests” ou antes de aceitar uma alteração no engine.

Última revisão operacional: **2026-10-09** (retoma passiva durável e ACK após ingestão). Mapa estrutural de transporte: **2026-10-08.1**. Mantém limite de upload, testes UI nos Workers e estatísticas de transporte de 2026-10-06 (`adr/ADR-0093` e `adr/ADR-0095`).

## 1. Limites de segurança

- Trabalhe somente com operações nomeadas do Desktop e recursos temporários pertencentes ao Wharnex.
- Não leia prosa da resposta do assistente, cookies, storage, credenciais, corpos/headers de rede nem DOM bruto. A exceção de raciocínio visível continua limitada pelo contrato normativo do projeto.
- Scripts injetados retornam somente estado estrutural, metadados de controles e geometria limitada. O processo principal executa o input confiável.
- Operações de conta não podem depender de `HTMLElement.click()`: o script localiza e devolve o alvo; o processo principal confirma o alvo e envia o evento nativo.
- Nunca use conversas, projetos ou artefatos reais como fixture destrutiva. Crie primeiro um recurso temporário com identidade Wharnex comprovável.
- Autenticação, CAPTCHA, verificação humana e acesso negado falham de forma fechada. Rate limit é uma pausa automática, não uma solicitação de ação humana.

## 2. Responsabilidade dos pools

| Pool | Operações | Cadência normal |
|---|---|---:|
| Supervisor | `BOT_WRITE`, `RECOVERY_WRITE`, `AWAIT_RESPONSE` e observação do bundle esperado do chat vinculado | Não usa o pacer comum de Worker |
| Worker | `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_TEMP_CHAT`, `DELETE_BUNDLE`, `TITLE_DISCOVER`, `TITLE_GENERATE_TEMP`, `TITLE_AWAIT`, `TODO_CLASSIFY`, `RELEASE_NOTES`, `ORCHESTRATOR_PLAN`, `ORCHESTRATOR_EXECUTE`, `UI_TEST_DISCOVER` e `UI_TEST_RUN` (no máximo uma execução UI de cada vez) | 10 s globais mínimos (alargados por pressão de 429) |
| Worker efémero (role `translator`) | `TRANSLATE_MARKDOWN`, `ORCHESTRATOR_PLAN` e `RELEASE_NOTES`; cria uma instância por tarefa, que vive até a tarefa terminar (um plano em WAITING mantém a conversa aberta), sem limite de política nem competição com os Workers | 5 s para tradução; 10 s para os outros, com prioridade máxima no pacer |

`DELETE_DOUBLE` não é um tipo durável atual. A remoção de artefato duplicado/expirado é representada por `DELETE_BUNDLE`; duplicidade de tarefas é controlada por `dedupe_key`.

A suspensão automática por rate limit aplica-se somente aos **Workers persistentes**. Supervisores e Translator continuam a fazer claims e executar as suas operações. Evidência 429 observada por qualquer superfície continua a alimentar o estado durável que protege os Workers.

Por padrão ficam suspensos `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_TEMP_CHAT`, `DELETE_BUNDLE`, `TITLE_DISCOVER`, `TITLE_GENERATE_TEMP` e `TITLE_AWAIT`. `TODO_CLASSIFY` permanece elegível.

Desde `adr/ADR-0093`, **todos** os tipos de tarefa do navegador estão sob política, de qualquer pool. Na aba **Políticas** (gaveta de Agentes e monitor do navegador), cada categoria lista os seus tipos com o estado efetivo calculado pelo backend:

- **Ativo**;
- **Suspenso**, manualmente ou por omissão;
- **Cooldown**, por rate limit ou por limite de upload, com a hora de retoma.

Cada tipo e cada categoria tem **Suspender**/**Retomar**. Um hold durável `task:<TIPO>` é aplicado no claim de todos os pools, sem gastar tentativa. Retomar um cooldown liberta uma pausa da conta inteira e pede confirmação. **Suspender o pool de Workers inteiro** continua a ser o interruptor local do pool (tray incluído). A seleção por tipos antiga, guardada na política da Desktop, é migrada uma vez para os holds (`[chat-agent] worker type suspension migrated to task holds`).

## 3. Cadência global dos Workers

- Navegação, reload, tentativa de upload, submit e operação de conta de qualquer Worker compartilham o mesmo relógio global de 10 segundos por perfil com a conta saudável; a pressão durável de 429 alarga esse intervalo até 60 segundos.
- A fila desse relógio dá a vez primeiro às ações de tarefas que já chegaram ao ChatGPT (upload e submit) e só depois a novas navegações; o intervalo mínimo não muda. A aba Agentes mostra a fase de cada Worker (na fila de envio, a abrir conversa, a preparar, a carregar ZIP, a submeter, GPT a processar, a descarregar, a validar).
- Uma conversa longa recarregada só desenha as últimas mensagens, e a contagem de respostas do assistente pode ficar igual ou abaixo da referência registada no envio. Assim a resposta nunca parecia concluída, a supervisão declarava "sem sinal estrutural" e o pedido era reenviado. Agora, se a página não está a gerar, o composer está pronto e a última mensagem desenhada é do assistente, a resposta conta como concluída e a referência acompanha a página (`[chatgpt-supervision] baseline-rebased`). Um Worker preso a uma tarefa que não esteja na conversa dela volta a abri-la antes de supervisionar (`orchestrator-task-return`).
- Desde o `adr/ADR-0081` (implementado), uma tarefa do Orchestrator é um Main Request agentic. A tentativa `ORCHESTRATOR_EXECUTE` só conduz as rondas: envia cada pedido pendente pelo mesmo `preparePromptForChatGPT` de um chat. A supervisão (`AWAIT_RESPONSE`), o keep-continue (`RECOVERY_WRITE`), o download e o ack são os do agentic, servidos pelo Worker preso à tarefa. O ZIP de uma tarefa vai diretamente para `POST /api/orchestrator/tasks/{task_id}/bundle`, sem passar pelo renderer. Uma rejeição corrigível gera um `RECOVERY_WRITE` na mesma conversa; outra termina a execução (`fail-run`). Cada tarefa tem uma única conversa ChatGPT (`conversation_url` na tarefa), fixada no primeiro envio e usada em todas as rondas, correções, tentativas e retries. No log: `[orchestrator-round] submitted|adopted` e `[orchestrator-delivery] delivered|repair|failed-run|retry`. Desde o `adr/ADR-0082`, os Workers persistentes nunca reivindicam tradução, planeamento do Orchestrator nem release notes: essas tarefas criam sempre o seu próprio Worker efémero. Um Worker que executa uma tarefa do Orchestrator fica preso a ela (reivindica só a lane `h:<id da tarefa>`) até uma tentativa terminar em DONE, FAILED ou ATTENTION, ou até a lane ficar 15 minutos sem trabalho. Os outros Workers excluem essa lane, e ela não conta como capacidade livre para o auto scale. No log: `[chat-agent] orchestration-pin … pinned|released`, `orchestration-pin-released … reason=idle` e `[ephemeral-worker] created|destroyed`. Texto histórico: `TRANSLATE_MARKDOWN` entra primeiro num Worker persistente elegível e livre. Um scheduler dedicado mantém um loop temporário por tradução que excede a capacidade livre, cria um `Translator` por tarefa reivindicada e destrói a instância no fim. O limite dos Workers persistentes não limita as traduções; os IDs canónicos `translator-N` admitem até 64 instâncias simultâneas.
- O `Translator` usa o relógio global de tradução, com mínimo normativo de 5 segundos; ele não aguarda a cadência de 10 segundos dos Workers comuns.
- A tarefa de tradução tem `max_attempts=1`. Autenticação, gate humano, timeout ou falha de transporte terminam a operação sem retry e a interface mostra **“A tradução falhou. Tente novamente mais tarde.”**
- A cadência é aplicada também aos retries que realmente podem alcançar o ChatGPT.
- Antes da última ação de navegação, upload ou submit, o engine consulta novamente a suspensão. Se ela começou enquanto a operação aguardava o pacer, a ação é adiada sem alcançar o provedor.
- Um adiamento anterior ao contato com o ChatGPT é uma observação gratuita: não consome a tentativa durável da tarefa.
- Pressão recente do provedor pode aumentar a separação; nunca pode reduzi-la abaixo dos mínimos acima.

Implementação principal: `services/desktop/chat-agent-pacer.mjs` e os limites finais em `services/desktop/main.mjs`.

## 3A. Limite de upload da conta (desde 2026-10-06, `adr/ADR-0093`)

O ChatGPT limita os uploads de ficheiros por conta numa janela móvel. Atingido
o limite, o menu "+" do composer mostra o item de anexar desativado ("aguarde
2 horas"). A seleção nativa do ficheiro continua a ser aceite, mas nenhum
pedido de upload sai da página. **Não é falha do scraper**: com outra conta, o
mesmo pedido carrega à primeira (confirmado ao vivo em 2026-10-06).

- **Evidência.** Duas tentativas seguidas sem arranque
  (`ChatGPT did not start the file upload before timeout`), de qualquer
  superfície e sem upload confirmado entre elas, abrem o gate da conta. Basta
  uma quando a sonda estrutural mostra os controlos de upload do composer
  todos desativados. A sonda lê só `disabled`/`aria-disabled` e contagens,
  nunca texto.
- **Gate aberto.** Todas as ações com upload, de qualquer pool, adiam antes da
  seleção do ficheiro como observação gratuita. Não há 5 retentativas locais e
  não se gasta tentativa.
- **Janelas e sonda.** As janelas são de 10, 20, 40, 80 e depois 120 min.
  Quando uma janela termina, só um upload entra como sonda: se confirmar, o
  gate fecha; se não arrancar, o gate reabre na janela seguinte.
- **Fecho.** O gate também fecha com um upload confirmado, um login
  concluído, uma sessão importada ou limpa, ou **Libertar limite** no UI Lab
  (use-o depois de trocar de conta).
- **Estado durável.** O hold `chatgpt_upload` (`GET /api/automation-holds`)
  mantém a janela após reiniciar a Desktop.

Log: `[chatgpt-upload-limit] not-started wc=… structural=… inputs=a/b
triggers=c/d`, `opened level=… until=…`, `probe owner=…`, `closed reason=…`.
O mapa estrutural do controlo desativado ainda não foi confirmado ao vivo. Na
próxima ocorrência natural, registe as contagens `inputs`/`triggers` aqui e
fixe a regra estrutural.

Os testes UI correm nos Workers persistentes. O browser efémero serve apenas
para navegar a aplicação testada. **Suspender testes UI** levanta os holds
`task:UI_TEST_DISCOVER` e `task:UI_TEST_RUN`.

## 3B. Estatísticas de bundles no workspace (`adr/ADR-0095`)

O contador no canto inferior direito mantém a janela móvel de três horas.
Clicar nele abre uma janela interna com **enviados**, **recebidos** e **total**
por tipo de tarefa, abrangendo todos os projetos, Supervisores, Workers e
Workers efémeros. O total de cada linha conta ficheiros ZIP, não tarefas:
passos UI, guias, partes e reenvios confirmados contam individualmente.

Em runtimes persistidos, `GET /api/bundle-quota` calcula a janela completa do
log operacional. `[chatgpt-upload] confirmed … observed=true` prova um envio;
preparação e retry sem confirmação não contam. O campo `name` acrescenta
somente o nome canónico do ficheiro, sem caminhos privados.
`[chatgpt-bundle-received] completed file=… bytes=… task=…` regista um download
concluído antes da validação sem ler ou guardar o seu conteúdo no log.

Recebidos anteriores a esse registo são estimados a partir de entregas locais
e marcados com `*`; um download e a entrega posterior contam uma só vez.
Tipos desconhecidos continuam visíveis. Falhas de consulta preservam os
últimos valores no UI e mostram o erro, sem apresentar zero como sucesso.
O modo sem PostgreSQL identifica explicitamente a contagem por artefactos
preparados. O limite apresentado continua a ser uma estimativa local
configurável e não consulta a quota oficial da conta.

## 4. Suspensão automática por rate limit

### 4.1 Detecção

Só o controle estrutural de rate limit exposto pela página do ChatGPT (DOM) abre a suspensão dos Workers.

Um HTTP 429, de qualquer endpoint e mesmo repetido, é apenas registado no log `[chatgpt-http]`. As páginas do ChatGPT fazem pedidos de fundo próprios, e o ChatGPT recusa alguns (sobretudo a lista de conversas da barra lateral) enquanto a conta continua a submeter normalmente. Numa noite, 48 recusas desse tipo suspenderam os Workers 19 vezes sem qualquer limite visível.

A detecção é estrutural e independente do idioma. Não use texto localizado da página para decidir.

### 4.2 Duração configurável

Na aba **Agentes → Políticas**, o campo **Suspensão automática por rate limit** aceita:

- padrão: **7,5 minutos**;
- mínimo: **1 minuto**;
- máximo: **60 minutos**;
- incremento: **0,5 minuto**.

O valor é normalizado e persistido na política do Desktop. Alterá-lo afeta as próximas suspensões; uma suspensão já ativa nunca é encurtada por uma observação posterior ou por um valor menor.

O backend persiste `paused`, `paused_until`, `reason`, `rate_limit_level`, `last_rate_limit_at` e `last_rate_limit_source`. Reiniciar o Desktop durante a janela não libera os Workers.

### 4.3 Comportamento durante a pausa

1. O scheduler dos Workers deixa de fazer novos claims; Supervisor e Translator continuam operacionais.
2. Navegação, upload e submit de Worker fazem uma última verificação antes da fronteira do provedor.
3. Comentários, recuperação e continuações dos Supervisores não são bloqueados pelo cooldown dos Workers.
4. `ChatGPTRateLimitDeferral` preserva o erro tipado e marca `retryUpload=false`, evitando cinco retries locais de uma ação que não chegou ao provedor.
5. O adiamento não consome tentativa da tarefa e não cria atenção humana.
6. Uma operação de Worker que já atravessou a fronteira antes da detecção pode terminar, mas nenhuma nova etapa de Worker é iniciada sem consultar novamente a suspensão.

### 4.4 Retomada obrigatoriamente confirmada

O fim de `paused_until` não libera a fila por si só:

1. Somente Workers continuam bloqueados por `chatAgentRateLimitResumeBlocked()`.
2. Exatamente um Worker é escolhido para a confirmação.
3. O Worker passa pelo pacer global e recarrega sua URL confiável atual. Se não houver URL confiável residente, carrega `https://chatgpt.com/`.
4. Depois de `reload()`, o engine aguarda o início real da navegação e a estabilização do carregamento/rede.
5. O engine executa `chatGPTHumanActionScript()` e exige um objeto estrutural válido com `rateLimited === false`.
6. Autenticação, CAPTCHA, acesso negado, resultado ausente ou página ambígua mantêm a fila bloqueada e reagendam a confirmação.
7. Um gate de limite ainda presente no DOM abre outra suspensão completa usando a política atual; um 429 durante o reload é só registado.
8. O backend pode limpar o estado temporal expirado ao ser consultado, mas o bloqueio local de retomada dos Workers permanece. Somente a confirmação saudável permite novos claims de Worker.

O log de sucesso esperado é:

```text
[chat-agent] rate-limit resume confirmed slot=worker-N url=https://chatgpt.com/...
```

Nunca aceite uma implementação que libere a fila apenas porque o relógio expirou.

## 5. Investigação estrutural controlada

1. Consulte o estado durável do provider e confirme que ele não está pausado. Não force uma rodada enquanto houver cooldown.
2. Confirme que o chat de teste está ocioso e que não existe request real em geração.
3. Execute uma única operação por vez numa fixture temporária.
4. Registre somente atributos estruturais permitidos: papel, `data-testid`, visibilidade, estado `disabled`, retângulo do alvo, contagens limitadas e URL sanitizada.
5. Compare o resultado com:
  - `services/desktop/chat-agent-behavior.mjs`;
  - `services/desktop/chatgpt-dom.mjs`;
  - `services/desktop/chatgpt-account.mjs`;
  - `services/desktop/chat-agent-scripts.mjs`.
6. Escreva primeiro uma regressão na menor camada útil e depois altere o seletor ou a máquina de estados.
7. Preserve a validação estrita do artefato e a fronteira que proíbe leitura de conteúdo remoto.
8. Remova toda instrumentação temporária `[DEBUG-...]` antes de concluir.

### Mapa estrutural confirmado em 2026-09-25

- O histórico expõe `data-conversation-options-trigger`; o `data-testid` visual pode ser `history-item-<n>-options` ou `undefined-options` e não serve como identidade durável.
- O menu da conversa carregada expõe `button[data-testid="conversation-options-button"]`. Use-o somente para a conversa cujo URL/id foi confirmado.
- O botão do cabeçalho pode ter `aria-label="Mais"` e não declarar `aria-haspopup`; a identidade primária vem do `data-testid`, nunca do texto localizado.
- Itens de ação expõem `data-testid` específicos. `role="menuitem"` pode estar no mesmo nó ou num ancestral; resolva o `data-testid`, suba somente até o controle acionável e mantenha labels localizados como fallback fechado.
- Scripts de conta localizam controles e retornam o alvo. O clique final precisa ser input nativo confiável.
- O popover de esforço pode apresentar um slider utilizável sem `aria-expanded="true"`. Um único slider definido em `effortSlider` e limitado ao composer é a evidência de menu aberto.
- O inverso também acontece: o gatilho fica `aria-expanded="true"`/`data-state="open"` com um `[role="slider"]` no documento que `effortSlider` não aceita. Um gatilho aberto nunca volta a ser premido nem recebe Enter/Space/Down, porque isso fecha o menu (o Worker abria e fechava o menu várias vezes seguidas). O slider é procurado dentro do menu indicado por `aria-controls` (ou no único menu aberto); se não aparecer após observações limitadas, o menu é fechado uma vez com Escape e o log `[chatgpt-effort] slider-unavailable … sliders=[…]` regista a forma de cada slider (`usable`, `visible`, `now`, `max`, `inMenu`, `hiddenBy`) para atualizar o mapa.
- Worker oculto não pode depender de `webContents.sendInputEvent` sem viewport/hit-testing válidos. Use a operação estreita `pressChatGPTControl`; não substitua por click DOM.
- **Interagir aqui** mostra a mesma instância num painel de 340 px de altura e muda o viewport do ChatGPT para o layout compacto. Enquanto uma tarefa corre, essa mudança interferiria com os controles que o scraper está a localizar; a abertura é recusada. **Acompanhar instância** e **Seguir (flow)** abrem a própria vista do Worker numa janela local fixa de 1280 × 900, sem navegar, focar explicitamente o conteúdo remoto ou fazer claims; fechar a janela devolve a instância ao estado oculto. A captura de imagem de uma vista oculta tem prazo de 5 s e pode falhar quando Chromium não produz frames; não é usada para acompanhar em tempo real. Um Worker já em interação não faz novos claims até a interação terminar.
- O acompanhamento fecha a janela quando a tarefa seguida termina. Um ZIP exato já visível após retoma deve ser procurado mesmo que a contagem de turnos do assistente não avance; o Worker tenta novamente o controle de transferência após 20 s se nenhum download arrancar, e para de clicar assim que Chromium sinaliza o início.
- **Seguir (flow)** abre imediatamente a janela nativa do Worker mesmo quando o painel de Agentes cobre a aba Engine. **Interagir aqui** usa essa janela em tamanho real quando o Worker está ocupado; a interação embutida continua disponível quando está ocioso. **Capturar imagem** apresenta temporariamente a vista do Worker em 1280 × 900 para obter um frame do compositor e depois repõe a vista oculta. Um probe DOM que não responde termina após 8 s por tentativa, sem prender uma tarefa indefinidamente.
- A entrega de um bundle `ORCHESTRATOR_EXECUTE` ao backend pode incluir verificação e aplicação Protected. O POST local usa um cliente HTTP com prazo explícito de 29 min, inferior ao limite de escrita de 30 min do backend, e preserva `X-Wharnex-Trace`; o `fetch` padrão cortava a resposta aos cinco minutos e cancelava a execução depois de o ZIP já ter sido descarregado.
- Todo gerador de script de conta deve entrar em `ALL_SCRIPTS` e passar por compilação com `new Function`. Regex dentro de template strings precisam preservar dupla fuga (`\\/`).
- O composer atual pode expor três `input[type=file]`: vídeo/imagem,
  imagem e ficheiro geral sem `accept`. O upload de ZIP deve preferir o ID ou
  `data-testid` explícito e, na ausência deles, o input geral sem `accept`
  dentro do composer. Nunca selecione o primeiro input `multiple`.
- Regressão de manutenção de **2026-10-05** (`revision=2026-10-05.1`): a
  seleção de ficheiro e a observação do upload usam a mesma procura de
  composer utilizável que o preenchimento/submissão. Uma superfície SPA
  dormente pode conservar outro `#prompt-textarea`: `querySelector` global
  selecionava o input dessa superfície e observava os seus marcadores, mesmo
  com o composer ativo pronto. A regressão
  `chatgpt/transport/uploads/upload-active-composer.test.mjs` verifica o input
  ativo e a confirmação do anexo, reproduzindo antes da correção o timeout
  `ChatGPT did not start the file upload before timeout`. Esta reprodução
  local não substitui a confirmação do reenvio ao vivo após rollout.
- Cada Supervisor possui a sua própria fila de transporte. Um upload em
  `supervisor-1` só adia chats que realmente precisariam dessa instância; não
  bloqueia um chat residente ou disponível em `supervisor-2`.
- **Retomar pedido** decide pela conversa vinculada, nunca apenas pelo estado
  local. Ele procura um turno de utilizador estrutural que contenha um resource
  card com o nome canónico exato do ZIP de entrada desse request. Somente essa
  prova DOM autoriza a continuação curta `keep continue`; não se lê a prosa do
  turno nem a resposta. `BOT_WRITE=DONE`, `AWAIT_RESPONSE`, upload confirmado,
  spinner ou POST observado não substituem a prova DOM. Se ela faltar, Retomar
  cancela a supervisão obsoleta e usa o reenvio idempotente do prompt + ZIP
  completos a partir do artefacto persistido. A ação continua bloqueada para
  request substituído, bundle já validado ou conversa com transporte ativo.
- Um request **nunca depende de túneis** (`adr/ADR-0074`). A preparação, o
  upload, a submissão, o reenvio e os comentários não chamam `/remote-input`,
  não esperam por nenhum provider e não colocam endpoints de túnel no ZIP nem
  no bootstrap do compositor. Os túneis servem apenas o webapp emparelhado.
  Se um request voltar a mostrar "a publicar túneis", é regressão.

Quando o mapa mudar, incremente `CHATGPT_BEHAVIOR.revision`, acrescente a regressão correspondente e registre a data da nova confirmação.

### Confirmação de transporte em 2026-10-08 (`revision=2026-10-08.1`)

- A conversa carregada pode não ter `data-message-author-role`, `data-turn-id`
  nem `#prompt-textarea`. Foram observados `data-chatgpt-agent-turn-start`,
  `group/user-message`, o compositor `role=textbox` e cartões `group/resource-card`.
  Conte o marcador do turno e compare a ordem com o último turno do utilizador;
  ausência dos marcadores antigos não significa ausência de resposta.
- O seletor acessível «Selecionar modelo do ChatGPT» não prova, sozinho, o nível
  de raciocínio. O transporte mantém 1280 × 900 durante a preparação e verifica
  as folhas do controle e o slider antes de selecionar o ZIP. O teste ao vivo
  confirmou `high`, um upload e um submit às 15:59 UTC.
- Um `BOT_WRITE` que falha depois do upload não pode voltar a selecionar o ZIP
  por rotina. Falhas estruturais ou seleção ambígua entram em `ATTENTION`;
  reenvios verificam primeiro o nome exato do ZIP no turno do utilizador e
  adotam a observação, inclusive na recuperação da entrada persistida.
- `ATTENTION` de transporte/paragem mantém a captura do ZIP exato sem reload
  nem continuação. Autenticação, acesso, verificação e Manual continuam a bloquear.
- Exclua o turno do utilizador e o compositor na busca de downloads: o bootstrap
  contém o nome esperado da resposta, mas não é o ficheiro de resposta.
- O ZIP do chat `5cf6288b-b066-4344-939e-891f8e15015f` foi recuperado sem
  reenvio às 15:40:58 UTC. O `host.applied` das 15:46:40 revelou-se falso sucesso:
  a integração deixou o submódulo backend antigo após `index.lock`. A conclusão
  exige comprovar os HEADs integrados e validar o comportamento real, conforme
  ADR-0096 e `.harness/logs/coordination-soft-delete.md`.
- Um nível selecionado com ícone não é uma folha DOM. Além das folhas, leia apenas
  texto direto de wrappers visíveis no único controle do compositor, com limites
  de 64 nós/120 caracteres. `5.6` e «Esforço de raciocínio» não provam um nível;
  valores desconhecidos ou múltiplos continuam a impedir o envio.

### Retoma passiva e ACK — 2026-10-09

- `observeSubmittedOnly=true` exige prova do ZIP exato no turno do utilizador
  e adota a captura sem upload/submit. O `AWAIT_RESPONSE` adotado persiste
  `observation_only=true`; a restauração mantém esse limite mesmo após reinício.
  Completion histórica não renova progresso nem autoriza continuação. A ausência
  do flag nos payloads antigos preserva o comportamento de supervisão existente.
- Não copie um `AWAIT_RESPONSE` antigo com `recovery_count=0` para representar
  observação passiva: isso pode voltar a autorizar um keep continue já gasto.
- O ACK só pode apagar o inbox depois de ingestão comprovada no destinatário.
  Uma janela que ignora um bundle por não possuir o pedido não o confirmou.
  Compare artefacto/plano/evento durável no backend antes de concluir entrega.
- O ZIP `req_20261008T165529_67647b0aab3c3fdb` foi recapturado às 08:37:55,
  16.876 bytes, e importado após a correção frontend; não houve novo envio.

## 5A. Observação ao vivo: reconstruir a linha do tempo de um request

Um request lento ou parado só se diagnostica com tempos absolutos. Nenhuma
fonte isolada chega; cruze-as por `request_id`, `task_id` e `chat_id`.

| Fonte | O que dá | Limitação |
|---|---|---|
| `harness_operational_log` / `GET /api/operational-log` (desde `adr/ADR-0075`) | **Primeira fonte a consultar.** Tudo o que o backend e a Desktop fazem, com hora, nível, componente e correlação (`request_id`, `chat_id`, `task_id`, `session_id`). Os eventos apontam para o corpo completo via `event_ref` | Expira: trace/debug aos 3 dias, o resto aos 15. Polling saudável fica só agregado por minuto |
| `docker logs wharnex-gateway-1` | Cada chamada HTTP Desktop/frontend → backend, com hora ao segundo, estado e bytes | Regista **na conclusão**; a ordem dentro do mesmo segundo não é fiável. `499` = o cliente abortou |
| `.harness/logs/desktop.log` | Eventos do scraper (`[chatgpt-worker-write]`, `[chatgpt-upload]`, `[chatgpt-submit]`, `[chat-agent] provider-rate-limit`, …), cada linha prefixada com timestamp ISO | O mesmo conteúdo chega ao registo operacional; o ficheiro é recriado a cada arranque |
| Tabela `harness_chat_agent_tasks` | Estado durável, `attempt`, `not_before`, `last_error` por tarefa | `last_error` é apagado quando a tarefa conclui |
| Tabela `harness_events` (`occurred_at`, `type`, `data`) | Linha do tempo da sessão: `artifact.persisted`, `conflict.prompt_ready`, `host.apply_*`, `self_evolution.*`, `automation.*` | Filtre por `session_id`; `harness_chat_agent_task_events` costuma estar vazio para tarefas do Supervisor |
| `.harness/logs/self-evolution.log` e `.harness/self-evolution/status` | Fases da ativação escritas pelo supervisor destacado | Se o supervisor morrer, nada mais é escrito (ver 5B) |

Desde a fase 2 do `adr/ADR-0075`, cada chamada relevante ao backend fica no
registo operacional (`component=http`) com duração e trace; o log do gateway
passa a ser só uma segunda fonte. Consultas úteis:

```bash
curl -fsS 'http://127.0.0.1:6969/api/operational-log?request_id=<req>&limit=500' | jq -r '.records[] | [.occurred_at,.source,.level,.event,.message] | @tsv'
curl -fsS 'http://127.0.0.1:6969/api/operational-log?chat_id=<chat>&min_level=warning&since=<ISO>' | jq .
# Tudo o que uma tentativa fez, Desktop + chamadas ao backend (o trace aparece como trace=… no desktop.log):
curl -fsS 'http://127.0.0.1:6969/api/operational-log?trace_id=task:<cat_…>:<tentativa>&limit=1000' | jq -r '.records[] | [.occurred_at,.source,.event,.message] | @tsv'
# Chamadas lentas ou falhadas da última hora:
curl -fsS 'http://127.0.0.1:6969/api/operational-log?component=http&min_level=warning&since=<ISO>' | jq -r '.records[] | [.occurred_at,.data.route,.data.status,.data.duration_ms] | @tsv'
db() { docker exec wharnex-database-1 psql -U wharness -d wharness -P pager=off -F $'\t' -Atc "$1"; }
db "select task_id,type,status,attempt,to_char(updated_at,'HH24:MI:SS'),left(coalesce(last_error,''),160)
    from harness_chat_agent_tasks where chat_id='<chat>' order by created_at desc limit 20"
db "select to_char(occurred_at,'HH24:MI:SS.MS'),type,left(data::text,220)
    from harness_events where session_id='<sessão>' and occurred_at > now() - interval '30 minutes' order by occurred_at"
docker logs --since <ISO> --until <ISO> wharnex-gateway-1 2>&1 \
  | grep -v 'tasks/claim\|runtime\|/api/events\|/api/health\|tasks/summary\|/git/head' \
  | awk '{print $4, $6, $7, $9, $10}'
```

### Sequência saudável de um `BOT_WRITE` (medida em 2026-09-25)

`POST …/tasks/<id>/start` → no mesmo segundo `…/knowledge`, `…/bundle`,
`…/context/maps`, `…/continuation`, `…/git/context` → ZIP local (~2 s para
14,7 MB/1485 entradas) → `POST …/artifacts` (ZIP, contexto, artefactos) →
compositor → upload → submit → `PATCH …/workspace-chats/<chat>/remote` →
`POST …/tasks` (`AWAIT_RESPONSE`) → `…/complete`. Total observado: **16 s**.

### Padrões de bloqueio conhecidos

- **Task do Orchestrator presa em DOING com plano aceite.** Um restart interrompeu a execução e a sessão ficou em `interrupted_execution.status=awaiting_decision`, à espera de um "retomar ou descartar" que numa task ninguém dá. A reconciliação retoma sozinha uma interrupção aprovada em modo Protected do run atual. Se a execução acabou em `failure_kind=execution_context_canceled` (sem intenção retomável), a task volta a READY com contexto, até três vezes.
- **Worker à espera de um ZIP já entregue.** O `worker-start` só oferece o pedido se ainda estiver em `pending_manual_request_ids`; com o bundle aceite, o Worker observa sem reabrir a conversa.
- **Leituras de conversa a cada claim.** Um claim de `ORCHESTRATOR_EXECUTE` já não abre a conversa da task; o executor abre-a, com ritmo, apenas para retomar ou submeter.
- **Envio não confirmado (`dispatched-unconfirmed`).** Acontece segundos depois de confirmar o upload de ZIPs grandes. A prova é o turno do utilizador com o ZIP exato na conversa: sem ela, o pedido é reenviado uma vez e, se continuar ausente, a tentativa falha antes de gravar checkpoint.
- **Worktree a "reverter" uma integração.** Um build de host morto a meio fazia o rollback restaurar os ficheiros mas deixar o HEAD no merge. O rollback repõe agora também o HEAD quando só há commits da integração do próprio Wharnex depois da baseline.
- **Deploy seguro.** `make restart` recria o backend e cancela execuções e builds de auto-evolução em curso. Só reiniciar sem `self-evolution/status` em `building` e sem sessões de tasks em DOING em `planned`/execução; as interrupções que escapem retomam-se ou relançam-se pelas regras acima.
- **"Não foi possível carregar esta conversa".** A página termina de carregar numa conversa (`/c/<id>`) sem composer, sem turnos de mensagem e com um único botão na área principal ("Voltar a tentar"). É o sintoma de um `GET /backend-api/conversations/<id>` recusado com 429. `waitForChatGPTSurfaceReady` deteta esta forma estruturalmente, sem ler texto, confirma-a em duas sondas com 2 s de intervalo e, passando pelo ritmo global quando é um Worker, prime esse botão uma única vez (ou recarrega se o botão não for único). Se a conversa continuar sem carregar, a ação é adiada sem gastar tentativa, com espera crescente por conversa (2, 4, 8 e depois 10 min), para o throttle de leitura passar. A espera só é reiniciada quando a conversa carrega de facto (turnos ou composer visíveis). Quando duas conversas diferentes falham em 2 minutos, é a leitura de conversas da conta que está limitada: os Workers deixam de abrir conversas de tarefas do Orchestrator durante 3 minutos, sem gastar tentativas. Quando esse período termina, só uma tarefa sonda (as outras esperam 30 s sem gastar tentativa); se a sonda também falhar, o período volta a armar-se com o dobro da duração (3, 6, 12 até 24 min). Só uma conversa que renderiza de facto (não o composer da página inicial) encerra a sequência e liberta as restantes. Antes, todas as tarefas reabriam a conversa ao mesmo tempo no fim do período, e essa rajada renovava o throttle, deixando as tarefas em DOING com todos os Workers parados. Uma página deixada nessa superfície volta sozinha a pedir a conversa a cada ~5 s, e cada 429 renova o throttle de leitura deste browser (a mesma URL abre sem problema noutro browser). Por isso, quando a tentativa termina, um Worker oculto (sem janela "Interagir aqui") devolve a sua lane e fica em `about:blank`; a próxima reivindicação volta a abrir a conversa. O log HTTP ≥ 400 inclui `wc=<id>` e `retry_after=` para identificar a página que insiste. No log: `[chatgpt-load] conversation-load-recovered|conversation-load-failed … backoff_ms=…`, `worker-parked` e `conversation-read-cooldown`.
- **Só heartbeats depois dos insumos.** A tarefa arranca, descarrega tudo no
  mesmo segundo e depois só aparecem `…/heartbeat` durante minutos. É a fase
  local (ZIP/persistência) presa. Antes de 2026-09-25 só o timeout implícito de
  300 s do `fetch` do Node a libertava (16:55:13 → 17:00:14 no chat
  `f3ebe00d-…`). Agora a fase tem prazo de 120 s e falha como tentativa
  repetível que não contactou o ChatGPT; a linha `[chatgpt-prepare]` diz em que
  fase parou.
- **"A preparar rotas remotas / publicar túneis".** Era a publicação remota a
  correr em série antes do ZIP (um túnel Cloudflare pode levar ~110 s).
  Removida por `adr/ADR-0074`.
- **`BOT_WRITE` a renovar lease com `loadURL` pendurado.** Uma navegação Electron
  que nunca resolve mantinha a tarefa viva. A navegação tem agora prazo de 25 s
  (`chatgpt-navigation-timeout.mjs`) e para o carregamento.
- **`AWAIT_RESPONSE` criado antes de o `BOT_WRITE` chegar a `DONE`.** A
  supervisão prematura fazia "Retomar" enviar só `keep continue` sem prompt/ZIP
  submetidos. Um write ativo ou terminal sem `DONE` nunca arma supervisão.
- **Pedido principal nunca submetido e pendente para sempre.** O pedido
  principal usa IPC direto, não `BOT_WRITE`, e por isso não tem retry durável.
  Se a preparação falha (no chat `7e463b09-…` o ZIP só foi persistido 300 s
  depois dos insumos, 15:48:42 → 15:53:43, e não houve upload), a falha fica
  apenas em memória do renderer e perde-se no reinício seguinte. O
  reconciliador de retoma armava então `AWAIT_RESPONSE` para um pedido que
  nunca saiu, que acabava em `ATTENTION`. Hoje a Desktop só arma com prova DOM
  do ZIP e responde `resend_required`, e o reconciliador converte essa resposta
  no aviso "Entrega falhou" com **Reenviar request**
  (`lib/pendingDeliveryResume.ts`). Assinatura: request pendente, apenas
  `artifact.persisted kind=bundle` sem `kind=context` depois, e nenhuma tarefa
  `BOT_WRITE`.
- **Várias chamadas `[chatgpt-worker-write] queued` para o mesmo request.** São
  normais: a `dedupe_key` `prepare:<request_id>` converge para uma tarefa.

## 5B. Estados presos depois de Apply ou build no host

Um primeiro upload que falhou antes de enviar pode deixar o ZIP de entrada
persistido e nenhum `chatgpt_url`. Após reiniciar, “Retomar pedido” encaminha
esse caso para entrega do arquivo completo, mediante ação humana. Antes de
abrir o composer, o Desktop verifica sessão/pedido pendente, ausência de
vinculação ou candidatos de recuperação e ausência de tasks de escrita ou
observação desse pedido. Evidência ambígua bloqueia o reenvio. O envio aceite
deve criar a vinculação concreta e a task `AWAIT_RESPONSE`; só o teste local
não comprova esses dois passos no chat ao vivo (ADR-0091).

Sintoma: a candidata continua `verified`, o chat não avança, não mostra falha e
não oferece ação. Verifique pela ordem:

1. `curl -fsS http://127.0.0.1:6969/api/self-evolution/block` e
   `.harness/self-evolution/status`. Uma fase `restarting` ou
   `restart_scheduled` com `updated_at` antigo significa que o supervisor de
   ativação (contentor `wharness-self-restart-<transação>`, criado com `--rm`)
   morreu sem escrever `restarted`/`rollback_*`. O único escritor dessas fases
   é esse supervisor; `awaitSelfEvolutionActivation` no backend só espera
   10 min e morre com o backend substituído.
2. Eventos `integration.startup_reconcile_failed` e
   `automation.local_recovery_retained` com
   `another Wharnex self-evolution transaction is already active` confirmam que
   todo o Apply está a ser recusado atrás desse lock.

Comportamento atual (2026-09-25):

- Uma ativação em `restarting`/`restart_scheduled` há mais de 15 min cujo
  supervisor já não existe (`docker inspect`; fora do modo stack decide só a
  idade) passa automaticamente a `restart_failed`. Fica registado
  `activation_abandoned` no `self-evolution.log` e o evento
  `self_evolution.activation_abandoned`. `restart_failed` é o lote pendente
  retomável: o chat mostra a ativação pendente e o Apply seguinte junta-se ao
  lote em vez de receber `ErrBusy`. Um supervisor que ainda corre nunca é
  interrompido.
- Um bloqueio `self_evolution_transaction_busy` aparece na Atenção como
  "Aplicação ao host bloqueada". A ação de repetir mostra a transação exata e
  só a liberta depois de confirmação explícita.
- A reconciliação da autoevolução corre em cada leitura de sessão. Ela só
  persiste e publica quando a projeção muda. Antes, cada `GET` regravava a
  sessão inteira (5,6 MB) e gerou 1008 eventos `batch_state` para uma só
  transação presa.

Caso de referência: `txn-20260925T111106-e95a54cd1c7e` ficou em `restarting`
das 11:16 às 16:55 (ativação de
`backend,desktop,frontend,gateway,tunnel,webapp`) até ser libertada à mão.

## 6. Operações que devem ser exercitadas

Use somente fixtures temporárias e cubra, conforme a mudança:

- criação de chat e confirmação da URL definitiva;
- envio de texto e do bundle/arquivo esperado;
- seleção de modelo e nível de raciocínio;
- criação ou reutilização exata do projeto Wharnex;
- organização/movimentação de conversa;
- descoberta e alteração de título;
- arquivamento e exclusão de conversa temporária;
- exclusão de bundle Wharnex expirado na biblioteca;
- tradução Markdown por artefato;
- classificação de TODO por artefato;
- observação e download do bundle canónico esperado.

Chats anónimos, conversas alheias, ficheiros sem identidade Wharnex e conteúdo de resposta não fazem parte da superfície autorizada de automação.

### 6.1 Armadilhas da manutenção ao vivo

Aprendidas nas sessões Codex e Claude de 2026-09-25:

- **O repositório muda debaixo de si.** Quando o chat monitorizado faz Apply no
  próprio Wharnex, o commit `Wharnex host snapshot before integration` absorve
  todo o trabalho não commitado, incluindo o seu. Outras sessões de agentes
  podem editar ficheiros ao mesmo tempo. Depois de cada Apply, reveja
  `git log`/`git status` e releia um ficheiro antes de o editar de novo.
- **Fixtures fora de `/tmp`.** O backend corre num contentor que não partilha o
  `/tmp` do host. Crie fixtures em `.harness/live-fixtures/<nome>` (estado
  ignorado pelo Git, mas visível ao backend).
- **Não force a janela de rate limit.** Durante uma suspensão de Workers,
  espere; os Supervisores continuam. Reiniciar o Desktop preserva a pausa.
- **Atribua falhas contra o baseline.** Crie um worktree em `HEAD`
  (`git worktree add --detach <scratch>/baseline HEAD`), faça symlink de
  `services/frontend/node_modules` e corra os mesmos ficheiros de teste nos
  dois lados. A suíte frontend ampla já tem dezenas de falhas pré-existentes.
- **Não corra suítes pesadas em paralelo.** Correr as suítes Go e Vitest ao
  mesmo tempo gera falhas de temporização que não se repetem isoladas (por
  exemplo `TestHostPTYBridgeKeepsShellAliveAcrossClientDetach`, testes de
  `GitDrawer`/`AgentWorkspace`). Confirme qualquer falha nova isoladamente.
- **"Retomar" não é "Reenviar".** Só com prova DOM do ZIP canónico no turno do
  utilizador se envia `keep continue`; sem prova, o caminho é o reenvio
  completo e idempotente (ver 5).
- **Rollout exige rebuild.** Uma correção no Desktop/backend só vale para o
  chat ao vivo depois de `make build`/reinício. Se outra sessão estiver a meio
  de alterações não commitadas, o rebuild leva-as também; coordene antes de
  reiniciar.

### 6.2 Preflight de patches e recuperação — incidente de 2026-10-06

No chat `571da97e-a35c-43e7-a1a4-5cd27caca7f5`, com contexto
`594b0dd833265fe7a1908752a242a29f6d8c6c77280189454e54fec1ea3be44a`,
o ledger registou `remote_input.failed` às **10:14:58 UTC**, uma recuperação
preparada às **10:15:18** e uma segunda rejeição às **10:19:26**, ambas com
`operation 0 patch preflight: patch must be raw unified diff without Markdown fences`.
A recuperação foi enviada por `BOT_WRITE` e terminou o envio na primeira
tentativa. A segunda rejeição esgotou o único reenvio automático permitido;
nunca se deve aumentar esse limite para esconder uma falha determinística.

A regressão local reproduziu a mesma mensagem com um diff válido, aceite por
`git apply --check`, que altera documentação contendo blocos de código. O
validador procurava três backticks no patch inteiro e recusava também conteúdo
legítimo dentro de hunks. A correção distingue linhas estruturais das linhas
de conteúdo contadas pelo hunk: estas preservam fences, aspas, backslashes e
exemplos de diff; wrappers Markdown externos continuam recusados, incluindo
fences de tildes. O contrato enviado ao provider segue a mesma distinção.

Regressões: `internal/protocol/patchdiff`,
`internal/executionbundle/patchcontent` e `internal/planner/delivery`.
Os ZIPs recusados não estavam no arquivo de artefactos da sessão; portanto a
reprodução confirma o defeito do validador, mas não prova o conteúdo dos dois
ZIPs originais.

**Verificação ao vivo:** o backend passou a usar a imagem
`7e14bda5e97c3082cdef74cf5998f773544f48531a507d311111b32320b6211c`
e ficou saudável. O pedido já existente
`req_20261006T105550_c9087c9391e36aa5` retomou a mesma conversa: upload
confirmado às **11:04:21**, submit aceite às **11:04:24** e
`BOT_WRITE cat_24d07541781867fe11d9` em `DONE`, com
`AWAIT_RESPONSE cat_d37857167ae2d4a320b5` em observação gratuita.
Não foi criado um envio duplicado durante a intervenção. Às **11:12:16**, o
bundle de resposta foi aceite (`bundle.received`, `plan.received`, Policy
permitida); às **11:12:18**, começou `execution.started` na sandbox Protected.
O erro de preflight não voltou nessa entrega. A conclusão da execução/Apply
é uma etapa posterior e não é inferida da aceitação do bundle.

Às **11:16:12**, a execução terminou com sucesso. O Apply ficou bloqueado
pelo `index.lock` do superprojeto, com mais de 18 horas. Uma única retoma
local de Apply confirmou a mesma recusa, conservando o candidato `verified`.
A operação nomeada `recover_index_lock` do bridge também recusou a limpeza:
`recovered=false`, `reason=process_visibility_incomplete`. O lock não foi
removido manualmente e não se abriu outro pedido GPT para este impedimento
local. O erro de importação ficou resolvido nessa intervenção; a recuperação
posterior do host e a aplicação concluída estão registadas em 6.3.

A fixture temporária local
`ses_20261006T110638_891e416e4e7147c8`, sem conversa no provider, confirmou
na API implantada que o wrapper é recusado (**HTTP 400**) e o diff com fences
literais é aceite (**HTTP 200**, `planned`). Correu em modo manual; o conteúdo
do host permaneceu igual e a sessão foi arquivada. Este teste de ingestão não
conta como uma amostra de transporte ChatGPT.

**Gates:** `go vet ./...`, as regressões focadas, a verificação HTTP acima e o
limite de 200 linhas passaram. `go test ./...` conservou a falha de
`TestRemoteInputChannelReusesMainRequestNamespaceAndRefreshesContext`; o
mesmo teste falhou no baseline `b24ea6d7`. `go test -race ./...` conservou essa
falha e a limpeza intermitente de `TestReArchivingDisposesNothing`; esta
última passou isoladamente no código alterado e foi reproduzida com `-race`
e 50 repetições no mesmo baseline. Não foram alteradas assertions.

### 6.3 Recuperação de bloqueios do host — 2026-10-06

No mesmo chat e candidato da secção 6.2, `recover_index_lock` reproduziu
`process_visibility_incomplete`: a prova dependia de enumerar os descritores
privados de todas as aplicações do utilizador. Além disso, processos Git
zombie eram classificados como ativos, embora já não possam manter ficheiros
abertos. A inspeção leu somente nomes/estado/UID e resultados de acesso, nunca
argumentos, ambientes, credenciais ou prosa do ChatGPT.

A recuperação agora combina nomes/estados completos do host, sem Git vivo,
com uma lease exclusiva do kernel sobre o inode exato (`adr/ADR-0092`). A lease
prova ausência de outros descritores sem acesso às aplicações privadas e fica
retida até à quarentena/remoção. Lock aberto, lease indisponível ou quebrada,
metadados incompletos e todos os outros impedimentos do ADR continuam recusados.
O comando original só pode ser repetido de forma limitada; não se abre GPT nem
se pede outra aprovação para a integração já autorizada.

**Ao vivo:** uma primeira prova atualizada recusou corretamente `git_process_active`.
Depois de esse processo terminar, a mesma operação recuperou o lock vazio com
`age_seconds=67322` e `reason=abandoned`, sem alterar índice/worktree. O Apply
avançou para o merge e os gates, encontrando às **11:33:46 UTC** outro problema:
`EACCES: permission denied, rmdir .../services/drcae-backend/dist/api/admin`.
Os descendentes gerados de `dist` pertenciam a UID 0. O merge foi revertido;
a reparação GPT indevida `req_20261006T113353_10b700caddc101e9` foi cancelada
pelo endpoint nomeado, preservando o candidato verificado.

Confirmados `git ls-files dist` vazio, exclusão Git de `dist`, `deleteOutDir=true`
no build e ausência de symlinks nos componentes do caminho, a intervenção
preservou a saída antiga em
`.harness/maintenance/dist-backend-20261006T1135`. Foi um rename reversível,
sem apagar conteúdo, chmod/chown ou escalar privilégios. O build recriou a
saída com a identidade corrente. A aplicação repetida passou todos os gates
e publicou **`host.applied` às 11:39:02 UTC**; a sessão terminou `applied`.
Esse evento declara os dois submódulos integrados e ainda não enviados ao remoto.

O motor passa a classificar um errno de filesystem concreto (`EACCES`/`EPERM`,
syscall e caminho) na verificação de host como `host_working_state_blocked`.
Lê ambos os streams: no caso real stdout trazia a causa e stderr somente
`exit status 1`. Faz rollback, conserva o candidato e oferece a correção local;
não salta o gate nem inicia GPT. A manutenção de `dist` acima não se torna uma
permissão genérica de remover artefactos ou mudar ownership automaticamente.

**Regressões:** `internal/gitops/recovery` verifica zombies, lock aberto,
inventário privado, lease quebrada e conservação de índice/worktree;
`internal/hostrepo/commitrecovery` verifica retoma da integração preservando
trabalho local. `internal/app/hostverification` reproduz a falha de permissões
com um Apply real, verifica rollback/candidato e ausência de pedido GPT.
Todas passam também com `-race`. O loop de gates foi extraído de `service.go`
para o módulo existente de verificação; novos ficheiros ficam abaixo de 200 linhas.

`go vet ./...` passou. As suítes completas normal e race, numa ferramenta
isolada com `/tmp` partilhado para os testes de supervisor Docker, conservaram
somente `TestRemoteInputChannelReusesMainRequestNamespaceAndRefreshesContext`
(a falha já atribuída ao baseline em 6.2). O primeiro ambiente de teste, sem esse
mount de `/tmp`, também recusava o supervisor efémero por não encontrar o seu
`worker.sh`; corrigiu-se o ambiente, sem alterar o teste. O gate global de tamanho
aponta `services/desktop/agent/scheduling/queue/scheduler/settlement.test.mjs`
(223 linhas), fora desta alteração; o de estrutura conserva os diretórios
legados `app` (291 ficheiros) e `uitesting/httpapi` (21). Nenhum foi ampliado por
esta correção. Os testes do verificador de estrutura passaram.

**Rollout confirmado:** o backend usa
`f794ad315e770389f441db4e1c24a9d3104baee1fc735f9d58d58543dd569323`,
com saúde `ok`, e a sessão continua `applied` após reiniciar. A restauração das
sessões demorou mais que a primeira janela de saúde; a ativação repetida
concluiu com a mesma imagem. O Desktop carregou a ponte Git recompilada: uma
fixture local com lock vazio de uma hora devolveu `recovered=true/abandoned`
no socket canónico; a fixture foi removida. Não se repetiu o envio ao ChatGPT.
Os módulos de protocolo, parsing do bundle e contratos do planner passaram
nas duas suítes. O gate de estrutura ainda aponta o diretório legado `app`
(291 ficheiros, também no baseline) e `uitesting/httpapi` (21 ficheiros,
fora desta alteração).

A refatoração ficou limitada à validação estrutural em `protocol/patchdiff`
e aos contratos de entrega em `planner/delivery`. Permanecem como dívida
nomeada, para extração noutras intervenções, o protocolo geral e revisão de
conhecimento em `planner/prompt.go` e o ciclo de vida/mapa de recursos do
canal legado em `app/service_remote_channel.go`.

## 7. Aceitação por tipo: regra 4/5

Para cada tipo alterado ou habilitado, crie cinco tarefas novas, isoladas e rastreáveis:

- `RENAME_CHAT`;
- `ORGANIZE_CHAT`;
- `ARCHIVE_CHAT`;
- `DELETE_CHAT`;
- `DELETE_TEMP_CHAT`;
- `DELETE_BUNDLE`;
- `TITLE_DISCOVER`, `TITLE_GENERATE_TEMP` e `TITLE_AWAIT` quando aplicáveis;
- `TODO_CLASSIFY`;
- `TRANSLATE_MARKDOWN`.
- `RELEASE_NOTES`, `ORCHESTRATOR_PLAN` e `ORCHESTRATOR_EXECUTE` quando alterados.

Critérios:

- aceite somente com pelo menos **4 sucessos em 5** para cada tipo;
- duas falhas do mesmo tipo tornam a rodada inconclusiva: pare esse tipo, faça investigação estrutural dirigida, adicione regressão e execute cinco tarefas novas;
- não complete a amostra repetindo somente o caso que falhou e não use retry ilimitado;
- TODO e tradução só contam quando o arquivo de nome exato é baixado e aceito pelo validador do backend;
- operação destrutiva só conta quando remove a fixture temporária exata, sem atingir outro recurso;
- registre apenas ID, tipo, estado, tentativas, timestamps, URL sanitizada e categoria estrutural de erro;
- qualquer 429 torna a rodada atual inconclusiva. Aguarde todo o fluxo de suspensão e confirmação antes de iniciar uma amostra nova.

## 8. Aceitação específica do rate limit

Confirme, preferencialmente a partir de uma ocorrência natural e sem provocar carga:

1. `paused_until` está à frente pela duração configurada.
2. Nenhum pool faz novos claims durante a janela.
3. Ações que alcançam a fronteira final são adiadas sem consumir tentativa.
4. Upload/continuação adiados não repetem localmente e não geram atenção humana.
5. Reiniciar o Desktop durante a janela preserva o deadline.
6. Na expiração, exatamente um Worker recarrega uma URL confiável.
7. Não há claims entre a expiração e o log `rate-limit resume confirmed`.
8. Página ambígua mantém o bloqueio.
9. Novo 429 abre outra janela completa; não é tratado como sucesso da retomada anterior.
10. Uma confirmação saudável permite a fila voltar e o backend retornar ao nível saudável.

## 9. Evidência da intervenção de 2026-09-19

Durante a correção que originou este procedimento:

- uma suspensão real por gate estrutural começou em `2026-09-19T18:43:41Z`;
- a duração persistida foi 7 minutos e 30 segundos, com expiração em `18:51:11Z`;
- uma continuação já existente revelou quatro retries locais de upload e atenção humana, embora nenhuma dessas tentativas tivesse alcançado o provedor;
- o retry genérico foi ajustado para propagar `ChatGPTRateLimitDeferral` imediatamente; essa regra permanece exclusiva das ações de Worker;
- o retry manual de uma entrega preparada passa por `withChatGPTSupervisorTransport` e chama upload/submit com `pacedWorker=false` e `rateLimitExempt=true`, portanto uma pausa dos Workers nunca pode produzir `ChatGPTRateLimitDeferral` nessa operação;
- o Desktop foi reiniciado antes da expiração e adotou a pausa durável;
- depois da expiração, `worker-1` recarregou `https://chatgpt.com/` e registrou `rate-limit resume confirmed` antes dos novos claims;
- após a expiração, o backend limpou o estado temporal para `paused=false` e `rate_limit_level=0`, enquanto o Desktop manteve os claims bloqueados até concluir a confirmação;
- um HTTP 429 posterior, num novo endpoint/ato do Worker, abriu corretamente outra janela completa de 7 minutos e 30 segundos, sem loop local de retry.

Esses horários são evidência histórica, não constantes de teste.

Resultados observados na mesma intervenção:

- testes focados finais do contrato de pacing/rate limit: **178/178**;
- suíte completa do Desktop após a correção e a regressão do retry manual: **430/430**;
- backend, incluindo `go test -race ./...`: aprovado;
- teste focado da aba Políticas e build frontend de produção: aprovados;
- lifecycle e export: aprovados;
- a suíte frontend ampla registrou 28 falhas em áreas fora deste diff. Elas foram reportadas e não tiveram assertions relaxadas; qualquer manutenção futura deve compará-las formalmente com o baseline antes de atribuir regressão.

## 10. Gates de verificação

Testes focados no contrato descrito aqui:

```bash
cd services/desktop
node --test \
  chat-agent-pacer.test.mjs \
  chat-agent-policies.test.mjs \
  chat-agent-scheduler.test.mjs \
  chat-agent-residency.test.mjs \
  chatgpt-upload.test.mjs \
  chatgpt-dom.test.mjs \
  chatgpt-account.test.mjs \
  chatgpt-request-preparation.test.mjs \
  chatgpt-navigation-timeout.test.mjs \
  chatgpt-request-delivery.test.mjs \
  main-regression.test.mjs

cd ../backend
go test ./internal/selfevolution -run 'Activation|SupervisorContainer'
go test ./internal/app -run 'AbandonedActivation|UnchangedSelfEvolution|ApplyRecovery'

cd ../frontend
npm test -- --run src/components/AgentRuntimeDrawer.test.tsx
```

Gates canónicos do repositório:

```bash
cd ../..
make backend-check
make frontend-check
make desktop-check
make lifecycle-check
make export-check
```

Também execute `npm run build` no frontend quando a aba Políticas for alterada. Falhas preexistentes da suíte ampla devem ser comparadas com o baseline não modificado e reportadas; não altere assertions alheias para fazer o gate passar.

## 11. Checklist final

- [ ] Política configurável aparece em **Agentes → Políticas** e persiste o valor normalizado.
- [ ] Cadência global é 10 s para Worker comum (alargada por 429) e 5 s para tradução.
- [ ] Supervisores e Translator ignoram a suspensão automática dos Workers; evidência 429 observada por eles ainda atualiza o cooldown durável dos Workers.
- [ ] Suspensão manual seletiva impede claims apenas dos tipos escolhidos e não incrementa `attempt`.
- [ ] Nenhum diagnóstico contém prosa remota, DOM bruto, cookies ou credenciais.
- [ ] Scripts retornam alvos; operações de conta usam input nativo confiável.
- [ ] Suspensão não consome tentativas nem gera retry storm.
- [ ] Retomada recarrega e confirma estruturalmente antes de liberar claims.
- [ ] Novo 429 reinicia a janela configurada.
- [ ] Cada tipo alterado alcança pelo menos 4/5 numa amostra nova.
- [ ] Nenhum caminho de request chama `/remote-input` nem espera por túneis.
- [ ] A preparação local tem prazo próprio e regista `[chatgpt-prepare]` por fase.
- [ ] Uma ativação sem supervisor vivo sai de `restarting` e oferece repetir.
- [ ] Leituras de sessão repetidas não regravam a sessão nem geram eventos.
- [ ] Falhas atribuídas contra o baseline, com cada suíte corrida isoladamente.
- [ ] Regressões focadas, build aplicável e gates sem regressão nova foram concluídos.

## 12. Rodada controlada de 2026-09-27

Todas as entradas abaixo pertencem à fixture do projeto Wharnex, chegaram ao bundle exato, terminaram em `DONE` na primeira tentativa e não produziram HTTP 429. Horários em UTC. A resposta de tradução e o corpo das release notes foram validados pelo backend; o diagnóstico não leu prosa remota.

| Tipo | Task ID | Criada | Concluída |
|---|---|---|---|
| `ORCHESTRATOR_PLAN` | `cat_6e8ea96dc9fd74bcc416` | 21:14:22 | 21:30:49 |
| `ORCHESTRATOR_EXECUTE` | `cat_36d16632653cd9877fd2` | 21:31:28 | 21:45:12 |
| `ORCHESTRATOR_EXECUTE` | `cat_befe96d25867f3473c9c` | 21:41:08 | 21:55:35 |
| `TRANSLATE_MARKDOWN` | `cat_3da439e3265d5d4d1b7a` | 22:02:24 | 22:03:44 |
| `TRANSLATE_MARKDOWN` | `cat_d34dca51825c57e48d18` | 22:07:21 | 22:08:38 |
| `TRANSLATE_MARKDOWN` | `cat_825559372b7592adc84d` | 22:20:10 | 22:21:28 |
| `TRANSLATE_MARKDOWN` | `cat_d63a1b7a2ef4b5065c9e` | 22:28:58 | 22:30:10 |
| `TRANSLATE_MARKDOWN` | `cat_1d6aadf2181f47470527` | 22:32:25 | 22:34:02 |
| `RELEASE_NOTES` | `cat_103cf5844800e744ac73` | 22:39:39 | 22:41:44 |
| `RELEASE_NOTES` | `cat_b532b0f17d7c5d5be0db` | 22:45:29 | 22:47:36 |
| `RELEASE_NOTES` | `cat_7619b85acf49f6d2d72d` | 22:49:24 | 22:51:01 |
| `RELEASE_NOTES` | `cat_a7e73939108318b62970` | 22:51:55 | 22:53:32 |
| `RELEASE_NOTES` | `cat_2e31a0af9c27f7cb559e` | 22:56:06 | 22:58:20 |

A tradução `cat_0159bb49b339548bf400` (23:14:33–23:15:58 UTC) foi uma sexta amostra diagnóstica, também `DONE` na primeira tentativa. O plano de teste passou `DRAFT → ACTIVE → COMPLETED`; as tarefas passaram `READY → DOING → REVIEW → COMPLETE` e `WAITING → READY → DOING → REVIEW → COMPLETE`. A promoção da segunda ocorreu sem ação manual. Os dois ficheiros de teste foram removidos após a confirmação.

A aceitação 4/5 de transporte foi atingida para `TRANSLATE_MARKDOWN` e `RELEASE_NOTES`. A pedido do operador, esta rodada usou uma única orchestration de raiz; `ORCHESTRATOR_PLAN` e `ORCHESTRATOR_EXECUTE` têm respetivamente uma e duas amostras, abaixo das cinco exigidas para aceitação estatística por tipo. O esforço `instant` das tarefas utilitárias e da segunda tarefa do Orchestrator permaneceu **não confirmado** no ChatGPT: na vista Worker oculta, o botão estava ativo, tinha geometria válida e recebia hover, mas as tentativas nativas não abriram o slider. O backend guardou corretamente o esforço pedido; o nível aplicado pelo provedor não pode ser afirmado. A tentativa antes do upload, o fallback de ponteiro e o ajuste do evento de teclado foram testados e retirados por não corrigirem a falha.

### UI Lab: retomar não liberta tarefas adiadas para 2100 (2026-10-06)

A instalação tinha o trigger provisório `wharnex_temp_hold_ui_tests` na fila
PostgreSQL. Ele voltava a atribuir `not_before=2100-01-01` em cada atualização
de uma tarefa UI pendente/em espera; libertar `task:UI_TEST_RUN` não chegava.
A recuperação removeu o trigger identificado e retomou 12 execuções e uma
descoberta, sem repor tentativas ou alterar payloads. A leitura da fila confirmou
zero tarefas UI adiadas para 2100 e uma descoberta em execução no `worker-3`.
O controlo do painel também passa a distinguir suspensão parcial (descoberta
ativa mas execução suspensa) e oferece retomar ambos os tipos.

Recuperação de compatibilidade: `scripts/ui-testing/recover-legacy-suspension.sql`
(aplicar numa transação). O teste PostgreSQL compõe a fixture e a consulta real:
`bash scripts/ui-testing/recover-legacy-suspension.test.sh | psql -X -v ON_ERROR_STOP=1`.
Não usar uma atualização genérica de `not_before`: esperas normais, tarefas
terminais e suspensões de outros tipos devem permanecer intactas.

## Escolha de modelo no composer (2026-10-09)

O choose de modelo consulta o menu de modelos do chat Engine apenas ao abrir o controlo. As opções são etiquetas do próprio ChatGPT, com estado selecionado/desativado; não existe catálogo estático. Operações `getChatGPTModels` e `setChatGPTModel` são nomeadas e limitadas ao Supervisor pertencente ao chat/janela. O script localiza; o processo principal envia input nativo e confirma a seleção. Durante pedido ativo, autenticação ou transporte Manual o controlo falha fechado. A preferência confirmada é guardada localmente por chat e reaplicada/validada antes do upload; depois do upload só é verificada. Modelos que não suportam o esforço solicitado deixam o pedido em atenção, sem reenvio ou redução silenciosa de esforço. Nada desta operação lê respostas, cookies ou storage remoto.

## Distinguir clique humano de captura automática (2026-10-09)

Um ZIP válido em `bundle-download started` prova a receção, mas só a linha
`chatgpt-bundle-dom download-triggered` prova que o poller ativou o controlo.
No fixture7caa5da3, a entrega create09:22 foi clique humano, sem esta linha,
por isso não é aceitação automática. O delete092629 também foi reportado
concluído pelo humano enquanto Wharnex continuava a aguardar.

O poll normal agora emite `chatgpt-bundle-probe` com estado categórico,
contagens e até16 identidades estruturais de controlos. O nome esperado vem
só da expectativa armada no main. Nunca retorna texto da resposta, títulos
de ficheiros alheios ou URLs. `exact-only-blocked` distingue um único controlo
genérico que seria fallback durante envio ativo mas não pode ser assumido
durante atenção/retoma passiva; `ownership`, `human-gate`, `preparing`,
`pending-delivery`, `loading` e `invalid-bundle-held` explicam gates anteriores
ao scan. O registo é por mudança ou30s, sem pedido ao provedor extra.

A seleção e o `.click()` existentes ficaram intactos nesta instrumentação.
Use a forma medida na página atual antes de modificar seletores ou input;
a hipótese de click sintético falhar ainda não foi comprovada no fixture.
O helper interno `chatGPTExpectedDownloadDiagnosticScript` é passivo e usa
o mesmo scan/decisão; nenhum parâmetro diagnóstico do renderer fornece
filename, selector ou script.

Resource-shape diagnosis supplements the same named expected-download operation. `resources` counts owned structural file/resource cards and contract matches (`expected`, `sameChat`, `sameRequest`, `otherResponse`) without logging observed filenames or labels. Filename leaf labels are considered only inside structural file/resource cards, excluding code/markdown/screen-reader regions; ordinary answer text is not inspected. Bounded marker ancestor shapes show whether the latest marker parent contains the resource or only a small control. `unavailable=true` cannot suppress a selected download. None of these metadata observations authorizes a broader download fallback.

Final closed complementary measurement: `resources.complement` observes only role-link/download/file-name/resource-test-id controls through download, aria-label, title, data-file-name and data-filename attributes. It returns counts/booleans/16shapes with capture-membership and visibility plus numeric viewport/root/main-scroll dimensions. No textContent, href, click or scroll operation is performed. Exact naming in this complement does not authorize activation; the original capture scan/decision remains unchanged. If no expected/ZIP control is observed after this measurement, obtain the filename/link the human saw rather than expanding collectors repeatedly.

Measured role-link regression (2026-10-09 10:24:20): fixture delete expected filename was present on three visible SPAN role=link controls reported as outsideCapture=true. This supplies direct evidence for a narrow capture correction; it is not a missing-artifact inference. The role-link path may use only bounded download/aria-label/title/data-file-name metadata, exact complete filename tokens, owned main/user-composer exclusion and disabled/visibility guards. It must not read textContent/href/nearby prose or permit a generic role-link fallback.

Second measured defect:10:34:32 `download-triggered mode=exact` from synthetic role-link click produced no will-download/bytes and stalled20seconds later. A successful selection log therefore proves only selection, not capture. Role-link activation now requires main-process trusted input to a freshly verified exact control; record pending only after native input acceptance and accept capture only with validated bytes. Passive diagnostics remain no-scroll/no-click. Legacy Worker string callers fail closed on role-link controls while retaining existing working controls.

### Catálogo de modelos: primeiro popup — 2026-10-09

Se inventory falhar com model-options-unavailable, consultar a linha classificada `[chatgpt-model-popup]` da mesma operação/chat. O getter mede somente o trigger e o popup ligado: sliders, opções reconhecidas, controlos de submenu e formas ARIA/geométricas. As imagens do utilizador mostram dois níveis, mas não definem seletores DOM. Esta etapa é passiva após abrir o primeiro controlo e não tenta selecionar esforço ou modelos por hipótese; medir as roles antes de ampliar o fluxo nomeado.
