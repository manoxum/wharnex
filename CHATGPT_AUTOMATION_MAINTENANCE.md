# Manutenção e aceitação da automação ChatGPT

Este documento descreve o contrato atualmente implementado para a automação do ChatGPT no Desktop, como investigar mudanças estruturais da página e como validar uma correção. Use-o quando uma atualização do ChatGPT quebrar uma operação, quando houver HTTP 429/“too many requests” ou antes de aceitar uma alteração no engine.

Última revisão estrutural e operacional: **2026-09-25**.

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
| Supervisor | `BOT_WRITE`, `RECOVERY_WRITE`, `ORCHESTRATOR_PLAN`, `AWAIT_RESPONSE` e observação do bundle esperado do chat vinculado | Não usa o pacer comum de Worker |
| Worker | `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_TEMP_CHAT`, `DELETE_BUNDLE`, `TITLE_DISCOVER`, `TITLE_GENERATE_TEMP`, `TITLE_AWAIT` e `TODO_CLASSIFY` | 30 s globais mínimos |
| Translator efêmero | Somente `TRANSLATE_MARKDOWN`; cria uma instância por tarefa e destrói ao terminar | 5 s globais mínimos |

`DELETE_DOUBLE` não é um tipo durável atual. A remoção de artefato duplicado/expirado é representada por `DELETE_BUNDLE`; duplicidade de tarefas é controlada por `dedupe_key`.

A suspensão automática por rate limit aplica-se somente aos **Workers persistentes**. Supervisores e Translator continuam a fazer claims e executar as suas operações. Evidência 429 observada por qualquer superfície continua a alimentar o estado durável que protege os Workers.

Por padrão ficam seletivamente suspensos `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_TEMP_CHAT`, `DELETE_BUNDLE`, `TITLE_DISCOVER`, `TITLE_GENERATE_TEMP` e `TITLE_AWAIT`. `TODO_CLASSIFY` permanece elegível. Na aba **Agentes → Agentes**, o operador pode suspender todos os tipos de Worker ou escolher um conjunto validado; a filtragem ocorre no claim e não consome tentativa.

## 3. Cadência global dos Workers

- Navegação, reload, tentativa de upload, submit e operação de conta de qualquer Worker compartilham o mesmo relógio global de 30 segundos por perfil.
- `TRANSLATE_MARKDOWN` não entra no pool persistente de Workers. Um scheduler dedicado reivindica somente esse tipo, cria o `Translator`, dispara automaticamente a operação e destrói a instância no fim.
- O `Translator` usa o relógio global de tradução, com mínimo normativo de 5 segundos; ele não aguarda a cadência de 30 segundos dos Workers comuns.
- A tarefa de tradução tem `max_attempts=1`. Autenticação, gate humano, timeout ou falha de transporte terminam a operação sem retry e a interface mostra **“A tradução falhou. Tente novamente mais tarde.”**
- A cadência é aplicada também aos retries que realmente podem alcançar o ChatGPT.
- Antes da última ação de navegação, upload ou submit, o engine consulta novamente a suspensão. Se ela começou enquanto a operação aguardava o pacer, a ação é adiada sem alcançar o provedor.
- Um adiamento anterior ao contato com o ChatGPT é uma observação gratuita: não consome a tentativa durável da tarefa.
- Pressão recente do provedor pode aumentar a separação; nunca pode reduzi-la abaixo dos mínimos acima.

Implementação principal: `services/desktop/chat-agent-pacer.mjs` e os limites finais em `services/desktop/main.mjs`.

## 4. Suspensão automática por rate limit

### 4.1 Detecção

Qualquer uma destas evidências abre a suspensão dos Workers:

- HTTP 429 observado num endpoint backend confiável de `chatgpt.com`;
- controle estrutural de rate limit exposto pela página;
- repetição de recusas classificada como gate da conta.

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
7. Um 429 durante o reload, ou um gate ainda presente, abre outra suspensão completa usando a política atual.
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
- Worker oculto não pode depender de `webContents.sendInputEvent` sem viewport/hit-testing válidos. Use a operação estreita `pressChatGPTControl`; não substitua por click DOM.
- Todo gerador de script de conta deve entrar em `ALL_SCRIPTS` e passar por compilação com `new Function`. Regex dentro de template strings precisam preservar dupla fuga (`\\/`).
- O composer atual pode expor três `input[type=file]`: vídeo/imagem,
  imagem e ficheiro geral sem `accept`. O upload de ZIP deve preferir o ID ou
  `data-testid` explícito e, na ausência deles, o input geral sem `accept`
  dentro do composer. Nunca selecione o primeiro input `multiple`.
- Cada Supervisor possui a sua própria fila de transporte. Um upload em
  `supervisor-1` só adia chats que realmente precisariam dessa instância; não
  bloqueia um chat residente ou disponível em `supervisor-2`.
- **Retomar pedido** envia somente a continuação textual curta na conversa já
  vinculada. Não rematerializa o contexto, não cria outro ZIP e não repete o
  upload do bundle de entrada. A ação manual pode ultrapassar o limite do único
  wake-up automático, mas continua bloqueada para request substituído, bundle
  já validado ou conversa com transporte ativo.
- O mapa de ficheiros das rotas remotas usa uma allowlist fechada partilhada
  com os providers: `context`, `context-map`, `knowledge`, `continuation`,
  `git-context`, `attachment` e `artifact`. Uma divergência nesta lista faz a
  publicação opcional falhar antes do upload e não deve ser tratada como uma
  regressão do scraper.

Quando o mapa mudar, incremente `CHATGPT_BEHAVIOR.revision`, acrescente a regressão correspondente e registre a data da nova confirmação.

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
  main-regression.test.mjs

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
- [ ] Cadência global é 30 s para Worker comum e 5 s para tradução.
- [ ] Supervisores e Translator ignoram a suspensão automática dos Workers; evidência 429 observada por eles ainda atualiza o cooldown durável dos Workers.
- [ ] Suspensão manual seletiva impede claims apenas dos tipos escolhidos e não incrementa `attempt`.
- [ ] Nenhum diagnóstico contém prosa remota, DOM bruto, cookies ou credenciais.
- [ ] Scripts retornam alvos; operações de conta usam input nativo confiável.
- [ ] Suspensão não consome tentativas nem gera retry storm.
- [ ] Retomada recarrega e confirma estruturalmente antes de liberar claims.
- [ ] Novo 429 reinicia a janela configurada.
- [ ] Cada tipo alterado alcança pelo menos 4/5 numa amostra nova.
- [ ] Regressões focadas, build aplicável e gates sem regressão nova foram concluídos.
