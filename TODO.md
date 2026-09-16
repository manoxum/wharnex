# TODO — registo desta sessão

Este ficheiro exporta tudo o que foi discutido, planeado e implementado numa única
sessão de trabalho sobre o Wharness: o diagnóstico e correção do beco sem saída da
auto-evolução, o plano (ainda por implementar na maior parte) de normalização do
protocolo ZIP e de evolução do protocolo WHX↔ChatGPT, e um backlog extenso de
pedidos de UI/UX do frontend, mais um incidente operacional de armazenamento.

Serve como ponto de retoma: qualquer pessoa (ou sessão futura) que abra este
ficheiro deve conseguir perceber o que foi pedido, o que ficou entregue, o que
ficou pendente, e porquê.

---

## 1. Solicitações (por ordem cronológica)

1. `make logs -f` falhava — pedido de explicação do erro.
2. Auto-evolução presa em `offline_host_go_module_cache` — analisar o chat
   `d8df7b954bc4` completo e corrigir todos os problemas.
3. Elaborar um plano minucioso para a correção.
4. Incluir no plano uma varredura completa do protocolo de comunicação para
   garantir que nunca há zip-in-zip e que cada troca usa no máximo um ZIP de
   pedido e um de resposta.
5. Normalizar os nomes dos arquivos para
   `whx_[req,res]_chatid_[request_id]?_[subrequests_id].zip`.
6. Incluir no plano a evolução do protocolo para o ChatGPT/WHX suportarem tipos
   de pedido mais diversos (features, análise de sistema, análise de risco e
   segurança, sugestões de melhoria, plano de execução real, troca de
   pensamento WHX↔ChatGPT, "grill-me", skills, o ChatGPT pedir mais contexto/
   comandos/logs ao WHX, testes e depuração, execução fora do sandbox quando
   permitido) — tornar o sistema mais agêntico.
7. Aprovação do plano final.
8. Aumentar um pouco a largura do painel de evidências de auto-evolução;
   melhorar a sua estética visual.
9. Corrigir todos os "verdes escuros" do frontend para um dark realmente
   preto/cinza — verde reservado a fontes quando necessário e a itens
   selecionados; padronizar a estética visual em toda a interface.
10. "Analisar com IA" (auto-evolução) não abre um chat com o Engine do ChatGPT.
11. Não é possível fechar todos os chats.
12. Melhorar a estética visual do painel de execução lateral.
13. Melhorar a estética visual do painel de plano lateral.
14. Melhorar o comportamento do explorador de ficheiros em modo agêntico — não
    deve redirecionar sempre para o Editor; deve permitir explorar e abrir
    ficheiros diretamente no modo agêntico.
15. No Editor, para ficheiros que suportam pré-visualização, permitir 3 modos:
    editor, pré-visualização, e ambos em simultâneo (split vertical).
16. No Editor, permitir split de telas, vertical ou horizontal (genérico).
17. Levar o terminal do Editor também para o modo agêntico, e permitir criar
    novos terminais.
18. Melhorar a estética visual dos chats arquivados; melhorar o modal de
    pré-visualização para mostrar ao lado a própria conversa com o ChatGPT que
    houve.
19. Na toolbar (Plano/Execução/Engine/ChatGPT): usar apenas ícone por aba,
    alinhar as abas à direita, mover o badge "WHX · AUTO-EVOLUÇÃO" para a
    esquerda.
20. Erro ao clicar em "Analisar com IA": `XMinioStorageFull` — MinIO cheio.
    Prioridade máxima.
21. Erro ao reentregar prompt ao ChatGPT: mesmo `XMinioStorageFull` — "isso já
    funcionava e quebrou".
22. No chat, distinguir por cor a mensagem do utilizador, a resposta do
    ChatGPT, e as notificações do WHX (prioridade baixa, marcado pelo próprio
    utilizador).
23. O painel de Engine/ChatGPT sobrepõe-se, por padrão, a todas as outras
    modais.
24. Fazer uma verificação profunda de todos os pedidos desta sessão, porque
    vários não chegaram a ser implementados; usar um mecanismo de TODO para
    gerir os pedidos (não existe ferramenta TodoWrite neste ambiente — foi
    substituído por uma tabela de auditoria mantida e mostrada ao utilizador).
25. Exportar toda a discussão para `NEXTLEVEL.md` na raiz do projeto (este
    ficheiro).

---

## 2. Diagnóstico e causa raiz do incidente original

A auto-evolução falhou repetidamente com:

```
offline sandbox dependencies unavailable: github.com/jackc/pgpassfile
```

**Causa raiz (verificada empiricamente, não por suposição):** o hidratador de
dependências Go do sandbox Protected, em
[`internal/sandbox/copy.go`](services/backend/internal/sandbox/copy.go), corria
`go mod download -json all` com `GOPROXY=off`. O padrão `all` percorre também as
dependências de **teste** das dependências — módulos nunca necessários para
compilar ou verificar este projeto — que não estão no cache do host. Cada um
falhava com `module lookup disabled by GOPROXY=off`, e a rotina abortava na
primeira ocorrência, produzindo um diagnóstico **falso** de "cache do host não
hidratado".

Medido com o `go.sum` commitado:

| Comando (`GOPROXY=off`) | Resultado |
|---|---|
| `go mod download -json all` | 6 erros (`stretchr/objx`, `x/mod`, `x/net`, `x/sys`, `x/term`, `x/tools`) |
| `go mod download -json` (sem `all`) | 0 erros |
| `go build ./...` / `go vet ./...` / compilar todos os testes | exit 0 |

O `all` também **reescrevia o `go.sum` do host** (9 linhas não commitadas na
árvore de trabalho eram artefacto deste bug, não uma alteração humana) — uma
violação do isolamento Protected, que promete que a preparação do sandbox nunca
muta a árvore-fonte do host.

Sobre isto empilharam-se três outros defeitos, todos confirmados por leitura de
código:

- **Classificação por substring de prosa.** O botão de recuperação
  ("Permitir rede restrita e repetir") só aparecia se `last_repair_error`
  contivesse literalmente `"offline sandbox dependencies unavailable"`. Mas a
  falha terminal real foi `"Planner reported failed: offline_host_go_module_cache: ..."`,
  construída por `plannerOutcomeFailureDetail`, que nunca contém essa
  substring — logo o botão nunca aparecia para esta falha.
- **O plano era apagado exatamente quando seria preciso para recuperar.** No
  caminho de ingestão de bundle ZIP, um outcome de planner não-completado
  apagava `Plan`, `Policy` e `LastExecution` da sessão. Como
  `RetryDependencyNetwork` exige esses três campos preenchidos e coerentes,
  a recuperação tornava-se impossível por construção.
- **O escape-hatch existente desviava-se do próprio SoT.** `enableGoDependencyNetwork`
  ligava `Network=true` diretamente em `go test`/`go build`, dando rede ao
  próprio código sob verificação — quando `SANDBOX_MODEL.md` já documentava que
  a aprovação deveria hidratar via um único `go mod download` com rede,
  mantendo os gates de verificação sempre offline.

---

## 3. Plano de execução aprovado

O plano completo (com todo o detalhe de código, ficheiros e critérios de
verificação) está gravado em
`/home/zootakuxy/.claude/plans/elabore-o-plano-minuncioso-glittery-plum.md`.
Resumo por fase:

### Fase A — Causa raiz da hidratação Go
1. Reverter o `go.sum` (artefacto do bug).
2. Trocar `go mod download -json all` por `-json` puro, com
   `GOFLAGS=-mod=readonly`; mensagens de erro passam a nomear o módulo e o
   `moduleRoot`, e a incluir o `stderr` capturado.
3. `domain.FailureKind` — classificação estruturada e fechada
   (`offline_go_module_cache`), derivada tanto de erros do sandbox como de
   `reason_code` do planner, com leitura retrocompatível via
   `sessionFailureKind` e limpeza única via `clearSessionFailure`.
4. Preservar `Plan`/`Policy`/`LastExecution` quando a falha é classificada como
   infraestrutura (nos dois caminhos: bundle ZIP e adaptador direto), zerar
   `RepairAttempt` (a tentativa não foi gasta a diagnosticar um defeito de
   código) e suprimir a auto-recuperação por pedido novo.
5. `injectGoDependencyHydration` — em vez de ligar rede ao `go test`, injeta
   **um único** `go mod download` com rede, antes da primeira operação Go
   elegível (ou depois de todas as operações, se só a verificação for
   elegível).
6. Bateria de testes cobrindo cada ponto acima, incluindo o teste que
   reproduz e prova a morte do beco sem saída original.

### Fase B — Invariante ZIP e nomenclatura (⏳ NÃO implementada)
1. Fechar os furos reais de zip-in-zip: mover extensões de arquivo
   (`.zip .tar .tgz ...`) e prefixos de diretório
   (`whx_bundle_`/`wharness-bundle-`/`wharness-input-`) para as listas
   **mandatory** de exclusão do `contextbundle` (hoje só uma regra
   `auto-exclude`, contornável por configuração de projeto ou por `include`).
2. Propagar `Session.ChatID` do frontend até ao backend (hoje o backend não
   tem qualquer noção de "chat", só de "sessão").
3. Renomear para `whx_bundle_req|res_<chatid>_<request_id>[_<subrequest_id>].zip`,
   com corte limpo (sem aceitar o formato antigo), reutilizando
   `RequestLineage{RootRequestID, ParentRequestID, Kind}` já existente para o
   `subrequest_id`.

### Fase C — Evolução do protocolo (⏳ NÃO implementada, faseada por desenho)
Consolidar primeiro (`internal/domain/turnkind.go` como fonte única de
verdade, relaxar `DisallowUnknownFields` em `turnWire`), depois introduzir um
kind `request` com pedidos tipados (`context`, `command`, `question`,
`evidence`) generalizando o `workflow` atual, depois as intenções de alto
nível (`security_review`, `grill`, `deliberation`), um registo de skills, e só
por último a execução fora do sandbox — por ser a superfície de maior risco.

---

## 4. TODO — auditoria final

### ✅ Entregue e verificado (testes + build passam)

| Item | O quê |
|---|---|
| Causa raiz Go | `goModuleInventoryCommand` sem `all`, `GOFLAGS=-mod=readonly`, mensagens com diagnóstico completo |
| `go.sum` intacto | Provado por teste (`TestGoDependencyInventoryDoesNotMutateHostGoSum`) |
| `FailureKind` estruturado | Campo novo, classificadores, leitura retrocompatível, limpeza única |
| Preservação do plano | Nos dois caminhos (ZIP e adaptador direto); `RepairAttempt` zerado; auto-recuperação suprimida |
| Escape-hatch de rede | Injeção de `go mod download` único, nunca liga rede a `go test` |
| "Analisar com IA" não abria o Engine | Reaproveita o sinal `chatgptAttentionNonce` que já foca a aba Engine/ChatGPT |
| Impossível fechar todos os chats | Passa a permitir zero chats, com estado vazio + botão "Novo chat" |
| Explorador em modo agêntico redirecionava para o Editor | `FilePreviewModal` — pré-visualização somente leitura in-place; "Abrir no Editor" continua disponível dentro do modal |
| MinIO `XMinioStorageFull` | Resolvido — disco do host a 100% por acumulação Docker de **todos** os projetos desta máquina partilhada (não era o Wharness: o bucket `wharness-artifacts` tinha só 138 MB); `docker image prune -f` + `docker builder prune -f` libertaram 3 GB → 33 GB, sem tocar em nenhum volume/BD de nenhum projeto |
| Engine/ChatGPT sobrepondo-se a modais | 3 gaps reais corrigidos (`data-chatgpt-overlay-blocker`): menu `@file` do composer, menu de canal de contexto, popover de ações do projeto. Diálogos grandes (confirmações, definições, diff, restart, túneis) já estavam corretos. **Por confirmar**: o utilizador mencionou um "modal de editor ChatGPT" específico ainda por reproduzir — precisa de screenshot no momento exato |
| Largura do painel de evidências | Nova classe `evidence-wide`, clamp(340px, 32vw, 460px) |
| Tema "verde escuro" → preto/cinza | **Parcial por escolha do utilizador** ("núcleo + chrome visível", não exaustivo): tokens centrais de `theme.css` neutralizados (desaturação preservando luminância); chrome fixo visível nos screenshots corrigido (`agent-drawer`, `agent-explorer-search`, `agent-drawer-icon`); dois bugs de variável CSS morta encontrados e corrigidos de caminho (`.execution-group-header`, `.project-execution-meta` usavam `--surface`/`--border`, nunca definidas) |
| Estética do painel de evidências | Cartões com hover, badges de categoria/tipo como pill, `<pre>` com fundo próprio |
| Estética de Planos/Execuções | Indicador de estado colorido (sucesso/falha), tipografia e espaçamento, truncagem corrigida no título |
| Estética dos arquivados | Cartão com hover, ações reveladas só ao passar o rato |
| Toolbar: ícones + alinhamento + badge | Feito — 4 abas só com ícone, alinhadas à direita; badge WHX movido para a esquerda da commandbar |

### ⚠️ Parcialmente entregue

| Item | O que falta |
|---|---|
| Tema "verde escuro" | Ficaram por tratar todos os hardcodes tinted que **não** têm override em `theme.css` fora do "chrome visível" já auditado — o utilizador escolheu explicitamente não fazer a varredura exaustiva agora |

### ❌ Não implementado

| Item | Nota |
|---|---|
| Invariante ZIP (Fase B.1) | Furos de zip-in-zip identificados mas não corrigidos no código |
| Renomeação `whx_bundle_*` (Fase B.2/B.3) | `Session.ChatID`, `internal/bundlename`, corte limpo — nada codificado |
| Evolução do protocolo (Fase C completa) | C2 (consolidação) nunca começou |
| Editor: 3 modos (editor/preview/split vertical) | Existe já um toggle binário editor↔preview por ficheiro (`previewPaths` em `EditorWorkspace.tsx`) que serve de base, mas o modo "ambos lado a lado" não existe |
| Editor: split genérico horizontal/vertical | Nada implementado |
| Terminal do Editor no modo agêntico + múltiplos terminais | Nada implementado |
| Modal de arquivado: mostrar a conversa ChatGPT ao lado | Adiado por escolha explícita do utilizador — exigiria embutir um webview ao vivo da `chatgptUrl`; não existe hoje qualquer transcript bruto do ChatGPT guardado, só o link |
| Cores diferentes por remetente no chat | Prioridade baixa, marcado pelo próprio utilizador; nada implementado |

---

## 5. Recomendações

1. **Sequenciar a Fase B antes da Fase C.** A renomeação de ficheiros e o
   invariante ZIP são a base de qualquer evolução de protocolo — adicionar
   novos tipos de pedido sobre nomes/formatos instáveis multiplica o custo de
   mudança mais tarde.
2. **Corte limpo na renomeação, não migração.** Já confirmado com o
   utilizador: pedidos pendentes no momento do deploy falham e são recriados;
   não vale a pena construir um caminho de compatibilidade para um formato
   efémero.
3. **C2 (consolidação do `TurnKind`) é a única parte da Fase C que compensa
   fazer mesmo que o resto fique para depois** — hoje a enumeração de kinds
   está duplicada em quatro sítios independentes do código; cada tipo de
   pedido novo (Fase C) multiplica essa deriva se C2 não for feito primeiro.
4. **Execução fora do sandbox (parte da Fase C) deve ser a última peça a
   entrar**, com revisão de segurança dedicada — é a superfície de maior
   risco de todo o plano.
5. **Antes de continuar o pente-fino visual "exaustivo" do tema escuro**,
   vale a pena decidir se compensa mesmo (são centenas de hexadecimais
   individuais, muitos já neutralizados por efeito colateral do fix de
   tokens) ou se o nível atual ("núcleo + chrome visível") já resolve o que
   se via nos screenshots.
6. **O item 23 (sobreposição do Engine) pode não estar 100% resolvido.** O
   utilizador mencionou um cenário específico ("modal de editor ChatGPT")
   que não foi possível reproduzir sem correr o Electron. Da próxima vez que
   isto aparecer, um screenshot no momento exato acelera o diagnóstico tal
   como aconteceu em todos os outros bugs desta sessão.
7. **Monitorizar o disco do host.** O incidente do MinIO não era do Wharness,
   mas esta máquina está perto do limite outra vez assim que os outros
   projetos voltarem a acumular imagens/caches Docker. Não há hoje nenhuma
   automação de limpeza — só foi feita manualmente, uma vez, com confirmação.
8. **Considerar implementar a "Limpeza automática" que o próprio utilizador
   já tinha pedido ao ChatGPT antes desta sessão** (referida nos logs
   originais): apagar automaticamente artefactos do MinIO com mais de 1 mês,
   com o valor configurável. Isto é independente do incidente de disco do
   host (que era Docker, não MinIO), mas resolve o problema de fundo que
   motivou aquele pedido.

---

## 6. Outras informações importantes

- **Não existe ferramenta `TodoWrite` (ou equivalente) neste ambiente.**
  Confirmado por `ToolSearch`. O acompanhamento de pedidos nesta sessão foi
  feito por uma tabela de auditoria mantida manualmente e mostrada ao
  utilizador a cada checkpoint — este ficheiro é a persistência definitiva
  dessa tabela.
- **Esta máquina partilha o Docker entre dezenas de projetos** não
  relacionados com o Wharness (`new-divida-deploy`, `flocoto-prod-*`,
  `drcae`, `siage`, `bindnet`, `teledrive`, `flowdocs`, `flowcore`, etc.).
  Qualquer limpeza de disco futura tem de continuar a ser cirúrgica
  (imagens órfãs / cache de build, nunca volumes) para não arriscar dados de
  outros clientes.
- **O mecanismo de "esconder o painel nativo do ChatGPT"** funciona por
  deteção de DOM: `ChatGPTDesktopPane` observa
  `[role="dialog"][aria-modal="true"], [data-chatgpt-overlay-blocker="true"]`
  via `MutationObserver` e manda esconder a `WebContentsView` nativa do
  Electron sempre que encontra uma correspondência. Qualquer overlay novo
  (modal, menu, popover) tem de propositadamente carregar um destes
  marcadores, ou fica sujeito a ser tapado pelo painel nativo — isto é uma
  armadilha fácil de esquecer em componentes futuros.
- **`EditorWorkspace.tsx` já tem uma base reaproveitável** para o pedido de
  preview/split (item 15): `previewPaths: Set<string>` já alterna, por
  ficheiro, entre editor e pré-visualização rica. O modo "split" pode
  construir-se em cima disto em vez de começar do zero.
- **O `service_evolution_evidence.go` é o molde comprovado** para qualquer
  intenção nova da Fase C que não precise de um `TurnKind` novo: um
  recolhedor de dados do lado Wharness, um marcador no preâmbulo do prompt,
  um `PlanningMode` forçado, e no máximo um campo opcional no turno.
- **Ficheiros/locais de referência desta sessão:**
  - Plano completo: `/home/zootakuxy/.claude/plans/elabore-o-plano-minuncioso-glittery-plum.md`
  - Causa raiz: [`services/backend/internal/sandbox/copy.go`](services/backend/internal/sandbox/copy.go)
  - Classificação de falhas: [`services/backend/internal/app/service_dependency_network.go`](services/backend/internal/app/service_dependency_network.go)
  - Preservação do plano: [`services/backend/internal/app/service.go`](services/backend/internal/app/service.go)
  - Modal de pré-visualização de ficheiro: [`services/frontend/src/components/FilePreviewModal.tsx`](services/frontend/src/components/FilePreviewModal.tsx)
  - Tema: [`services/frontend/src/theme.css`](services/frontend/src/theme.css)

---

## 7. Continuação — segunda ronda de pedidos

### Novas solicitações

26. Continuar a implementação dos próximos pontos planificados (Fase B).
27. Quando um bloqueio precisa de intervenção do utilizador (aprovação, permissão),
    deve aparecer também no próprio chat — hoje só aparecia no banner do topo, e
    quando aparecia no chat surgia estilizado como "erro", quando era apenas uma
    permissão a conceder.
28. Renomear toda a nomenclatura legado do projeto (Harness → Wharness) para o
    nome definitivo: **Wharnex**.
29. A mensagem "O Wharness criou automaticamente a requisição de correção 1/3…"
    tem pouca informação — deve mostrar o que aconteceu e porque foi precisa a
    correção. "O chat precisa de ser mais hidratado."
30. Nova funcionalidade: **exportar chat** — gerar um ficheiro ZIP com tudo o que
    aconteceu nesse chat: pedidos enviados, respostas recebidas, bundles
    trocados, comandos executados, logs, estado de cada execução, casos de
    sucesso e de falha. Deve permitir exportar tudo para análise externa.

### Entregue nesta ronda

| Item | O quê |
|---|---|
| Fase B.1 — invariante zip-in-zip | `mandatoryBlockedDirPrefixes` (novo) e extensões de arquivo movidas para as listas **mandatory** (não contornáveis por `auto_exclude`/`include`) em `contextbundle/builder.go`; assert defensivo em `addContextFile` que recusa qualquer entrada com extensão de arquivo; 4 testes novos provando o invariante mesmo com config permissiva |
| Aprovação vs. erro no chat | `pendingApproval` computado a partir de estado estruturado da sessão (`policy.requires_approval`/`failure_kind`, nunca prosa); a pausa de aprovação passa a aparecer como notice do Wharness, com o texto e o botão certo a apontar, e deixa de duplicar como "Execução do bundle falhou" |
| Notice de correção automática mais hidratado | Inclui agora `last_repair_error`/`last_execution.error` (truncado) na própria mensagem, explicando o que falhou |

### Fase B.2/B.3 concluída (ChatID + renomeação `whx_bundle_*`)

Novo esquema de ponta a ponta: `whx_bundle_<req|res>_<chat_id>_<request_id>[_<subrequest_id>].zip`.
Corte limpo — formato antigo (`wharness-bundle-*`, `wharness-input-*`) removido do
código e dos testes, não apenas do texto do prompt.

- **Backend**: `Session.ChatID` (novo campo) + `Service.SetChatID` (validado,
  sem `_`, já que é o separador do esquema); `internal/bundlename` como fonte
  única de verdade (construir/parsear); `planner.Request.ExpectedBundleFilename`
  computado a partir do `ChatID` da sessão e do `RequestLineage` (raiz vs.
  subpedido) em todos os 5 sítios que constroem um `planner.Request` (mensagem
  normal, correção automática, resolução de conflito, continuação de
  workflow); `bundleFilenameRequestID` (validação de bundles recebidos) e o
  transporte tunnel/remote-channel (`service_remote_channel.go`) atualizados
  para o mesmo esquema. `internal/contextbundle` já bloqueava (Fase B.1) os
  prefixos antigos e o novo `whx_bundle_` na lista mandatória de exclusão.
- **Desktop (Electron)**: novo `bundlename.mjs` (espelha o pacote Go);
  `security.mjs` reescrito — `canonicalWharnessBundleDownload` passa a validar
  também o `chat_id`, mantendo a normalização de sufixos duplicados do browser
  (`(1)`/`(2)`) com a semântica original (erro específico "pertence a outro
  pedido" antes de cair no erro genérico); `chatInputArchiveFilename` e
  `canonicalBundleFilename` (main.mjs) passam a exigir o `chatId`/`cacheKey`,
  já disponível em todos os chamadores.
- **Frontend**: `api.createSession` aceita `chat_id`; `newWorkspaceChat` aceita
  um id pré-gerado; `newChat()` e `analyzeEvolutionEvidence` geram o
  `crypto.randomUUID()` **antes** de criar a sessão e propagam o mesmo id para
  o backend e para o `WorkspaceChat` local (para que sejam sempre o mesmo
  identificador).
- Testes: 3 novos no pacote Go `bundlename`, 6 novos no `bundlename.mjs`
  (Node), mais todos os testes existentes (Go, Node, Vitest) corrigidos para o
  novo formato. **176 testes Go, 127 testes Node, 181 testes Vitest — todos a
  passar.**
- **Por decisão explícita**: caminhos de recriação de sessão em caso de falha
  (fallback ao restaurar um chat arquivado cujo `sessionId` já não existe,
  fallback ao arquivar o último chat) continuam sem propagar `chat_id` — o
  backend usa "system" como chatId nesses casos, seguro mas menos específico.
  Não é uma regressão: são casos de recuperação, não o fluxo principal.
- **Ainda não implantado** (`make build` não foi corrido depois desta ronda de
  alterações) — precisa de rebuild antes de qualquer chat novo começar a usar
  o novo formato.

### Ainda por fazer / a confirmar

| Item | Nota |
|---|---|
| Fase C (evolução do protocolo) | Por implementar |
| **Renomeação Wharness → Wharnex** | **Precisa de âmbito confirmado antes de começar** — toca o módulo Go (`kernl.local/harness/...`, provavelmente centenas de ficheiros), nomes de volumes/imagens Docker já em produção nesta máquina (`wharness-minio-*`, `wharness-postgres-*`, `wharness-tunnel-*`), variáveis de ambiente (`WHARNESS_*`), o ficheiro `whaness.yml`/`.harnessignore`, e toda a UI. Um rename cego arrisca órfãos de volumes Docker existentes e quebrar o stack a correr |
| ~~Exportar chat para ZIP de análise~~ | **Entregue** numa ronda posterior não documentada aqui na altura: `internal/app/chat_export.go` + `chat_export_format.go`, endpoint `POST /api/sessions/{id}/chat-export`, `onExportChat` ligado em `ChatPanel`/`AgentWorkspace`/`App.tsx`. Usado ao vivo nesta sessão (secção 16) para diagnosticar o chat `64623e2c-...` |
| Editor: 3 modos, split genérico, terminal agêntico | Por fazer |
| Cores de mensagem por remetente | Baixa prioridade, por fazer |

---

## 8. Destravamento de chats presos — diagnóstico e correção (prioridade máxima)

### O pedido

Três chats de auto-evolução não conseguiam terminar a aplicação ao host — o
utilizador identificou-os por fragmentos de hash vistos no chat
(`9e866daf06e4`, `db1db75165d8`, e um terceiro sem ID capturado) e pediu uma
análise profunda de tudo o que aconteceu (bundles, pedidos, respostas, logs,
comandos, eventos, retentativas) para encontrar a causa raiz e melhorar o
protocolo, o motor de aplicação de patches, o report de erro, os recursos do
sandbox e a estratégia de merge — para reduzir o "ping-pong" com o ChatGPT.

### Investigação (dados reais, Postgres `harness_sessions`/`harness_events`)

Os dois hashes fornecidos **não eram IDs de sessão** — eram fragmentos de
SHA256 vistos no texto do erro (um baseline de contexto, um hash de ficheiro).
Isso levou às sessões reais:

- `ses_20260906T153603_f8883ed677e4a4a9` — `stale_pending_baseline_requires_rebase`
- `ses_20260906T163618_1f1248d42792d0c3` — `host apply blocked by stale baseline: ... verified on 298d7324... but current baseline is db1db75165d8...`
- `ses_20260906T161152_532feebc54a62a87` — `self_evolution_transaction_active` (terceira, provável candidata)

Todas as três são sessões de **auto-evolução sobre o próprio repositório
Wharness** — ou seja, o mesmo projeto que esta própria sessão de trabalho
(Claude Code) esteve a editar em paralelo, durante horas.

**Causa raiz confirmada por leitura de código** (`service_baseline_concurrency.go`,
`service_baseline_notifications.go`, `service.go`):

`canFastForwardBaseline` — a função que decide se um plano pendente pode ser
aplicado apesar do baseline do projeto ter mudado entretanto — só conseguia
reconciliar mudanças através de `Session.BaselineNotices`. Esse histórico
**só é escrito quando OUTRA sessão Wharness aplica um plano através do
próprio pipeline de Host Apply** do Wharness. Qualquer edição externa ao
projeto — um `git` manual, outro editor, ou (exatamente o que aconteceu aqui)
o Claude Code a editar o repositório diretamente durante esta sessão — nunca
gera essa notificação. Resultado: a cadeia de reconciliação fica quebrada
logo no primeiro passo, `canFastForwardBaseline` devolve sempre `false`,
mesmo quando os ficheiros realmente alterados nunca colidiram com o plano —
e o Host Apply é bloqueado como "stale baseline" indefinidamente, gerando
pedidos de correção sucessivos ao ChatGPT que nunca resolvem o problema (cada
correção nova fica igualmente stale antes de voltar).

Fator agravante: `Session.ProjectRevisions` (o histórico que **é** sempre
escrito, em cada `refreshContext`, independentemente de quem causou a
mudança) já continha exatamente a informação em falta — mas
`canFastForwardBaseline` nunca o consultava. Além disso, os limites de
retenção (`BaselineNotices` a 20 entradas, `ProjectRevisions` a 64) eram
demasiado pequenos face ao volume real observado: **5121 eventos
`context.refreshed`** numa única sessão, **905** noutra.

### Correção aplicada

- `canFastForwardBaseline` (`service_baseline_concurrency.go`) passa a
  tentar reconciliar por **duas fontes independentes**: `BaselineNotices`
  (como antes) **e** `ProjectRevisions` (novo). Basta uma das duas conseguir
  percorrer a cadeia completa sem sobreposição de ficheiros para autorizar o
  fast-forward — nenhuma das fontes pode tornar um conflito real invisível,
  porque cada uma só afirma ficheiros realmente observados como alterados.
- Limites de retenção aumentados: `ProjectRevisions` 64→512
  (`maxRetainedProjectRevisions`), `BaselineNotices` 20→200
  (`maxRetainedBaselineNotices`), ambas em `service.go`.
- 3 testes novos em `service_baseline_concurrency_test.go` provando: (a) a
  reconciliação funciona só com `ProjectRevisions`, sem nenhuma
  `BaselineNotice`; (b) uma sobreposição continua corretamente bloqueada
  mesmo vindo só de `ProjectRevisions`; (c) quando uma fonte está incompleta
  mas a outra tem a mesma transição completa, a reconciliação é resgatada.
- Toda a suite do backend (`go test ./...`) passa.

### Implantação

✅ Feito — `make build` reconstruiu e reconciliou backend/frontend (Postgres,
MinIO e tunnel preservados, sem interrupção), confirmado saudável via
`make status`. Não foi preciso `make stop`/`make start`: o `make build`
já recria e reinicia backend/frontend sozinho. As duas sessões já falhadas
não se destravam sozinhas retroativamente (ficaram gravadas em `failed`
com o erro antigo); reenviar/repetir o pedido nesses chats deve agora
conseguir reconciliar corretamente, desde que os ficheiros do plano não
colidam mesmo com o que mudou entretanto.

### Achados secundários, ainda por resolver

| Achado | Nota |
|---|---|
| Sessão 3 (`532feebc...`) | Não há lock `active.lock`/`stage.lock` presente agora — não está permanentemente presa por um lock órfão. A falha `self_evolution_transaction_active` foi provavelmente uma colisão real e transitória com outra transação a decorrer (`txn-20260906T163355-...`). Mas registou **2872 eventos `command.output`** — a UI pode estar a "travar" ao renderizar um volume tão grande de output, não por bloqueio de backend. Vale investigar a performance de render do painel de execução com históricos muito grandes |
| Cadência de `context.refreshed` | 2s de ticker + 30s de full-refresh (`remoteChannelRefreshInterval`/`remoteChannelFullRefreshInterval`, `service_remote_channel.go`) é razoável isoladamente, mas combinado com um projeto ativamente editado em paralelo (este caso: auto-evolução sobre o próprio Wharness, editado ao mesmo tempo por este Claude Code) gera uma janela de baseline que um round-trip ao ChatGPT de vários minutos dificilmente alcança. A correção acima resolve a *reconciliação*; não reduz a *causa* da cadência alta quando o projeto é mesmo editado continuamente |
| Report de erro no chat | Ainda não instrumentado para este caso específico: quando um Host Apply falha por stale baseline, a mensagem no chat deveria dizer explicitamente quais ficheiros mudaram e porque a reconciliação falhou, não só "stale baseline blocks apply" |

---

## 9. Descoberta importante — `AGENTS.md` já resolve a questão Wharnex

Ao adicionar a nova norma de containerização (abaixo), reparei que
`AGENTS.md:1,3` **já declara**:

> `# AGENTS.md — Wharnex (WHX) normative root`
> `Existing Wharness, wharness-*, WHARNESS_* and kernl.* identifiers are
> retained where required for protocol, persisted-data and runtime
> compatibility.`

Ou seja: o documento autoritativo do projeto **já decidiu** que o nome é
Wharnex, mas os identificadores técnicos antigos (`wharness-*`, `WHARNESS_*`,
`kernl.*`) ficam **deliberadamente** como estão — não por receio de quebrar o
stack, mas como política permanente de compatibilidade de protocolo/dados
persistidos. O `CHANGELOG.md` também já tem `## Unreleased — Wharnex / WHX
identity, concurrency and account lifecycle` como cabeçalho atual.

Isto **contradiz** o âmbito "tudo, com migração de infraestrutura" que
escolheu anteriormente para o rename (que assumia mudar módulo Go, volumes
Docker, env vars). Segundo a própria regra de autoridade do `AGENTS.md`
("quando a implementação conflita com uma Source of Truth, a implementação
está errada, a menos que a SoT seja explicitamente alterada na mesma
mudança") — para fazer o rename completo que escolheu, seria preciso primeiro
**alterar esta linha do `AGENTS.md`** explicitamente, já que hoje ela proíbe
exatamente isso. Precisa de decidir: manter a política atual (só o nome
visível/novo código passa a Wharnex, técnico fica) ou alterar o `AGENTS.md`
para autorizar a migração completa.

## 10. Limpeza completa de dados (Postgres/MinIO/estado local)

### O pedido
Limpar todos os registos (Postgres, MinIO, chats, bundles, todos os
artefatos criados), mantendo apenas o projeto e a sessão do navegador
(login do ChatGPT).

### Executado
1. Levantamento prévio + confirmação exata do âmbito com o utilizador antes
   de apagar (229 sessões/14274 eventos no Postgres, 272MB no MinIO, 2.4GB em
   `.harness/`, ZIPs soltos não rastreados).
2. Parados `backend`/`frontend` (containers), mantidos `database`/`minio`/
   `tunnel` a correr para as operações de limpeza.
3. Postgres: `TRUNCATE harness_sessions, harness_events,
   legacy_session_migrations`.
4. MinIO: bucket `wharness-artifacts` esvaziado usando o `mc` **embutido no
   próprio container do MinIO** (`docker exec ... mc rm --recursive`), nunca
   uma ferramenta do host — por pedido explícito do utilizador durante esta
   limpeza, agora também formalizado como norma (ver secção 11).
5. Electron: `Local Storage`/`Session Storage`/`chat-attachments-v1` da
   janela principal apagados; `~/.config/wharness-desktop/Partitions/
   wharness-chatgpt` (sessão do ChatGPT) **intocado** (verificado antes e
   depois: 268MB inalterado).
6. `.harness/` apagado por inteiro (transações de auto-evolução, estado de
   remote-input, logs, cache).
7. ZIPs/diretórios soltos não rastreados na raiz e em `patches/` apagados;
   o único ZIP **commitado no git** (`patches/wharness-input-req_...zip`)
   foi deixado como está, por decisão explícita.
8. `make build && make start` para repor a stack.

### Incidente causado e corrigido durante a limpeza
Apagar `.harness/state/` por inteiro removeu também os ficheiros de
**credenciais** (`postgres.env`, `stack.env`) que não são artefactos de
sessão — são o segredo partilhado entre o backend e os volumes Docker **já
existentes e preservados** (Postgres/MinIO/tunnel). O `stack.sh` gerou
credenciais novas (aleatórias) para preencher o ficheiro em falta, mas os
volumes existentes continuavam à espera das credenciais **antigas**,
causando falha de autenticação no arranque do backend
(`database is unavailable or rejected the credentials`).
Corrigido lendo a password/token reais diretamente do ambiente dos
containers já em execução (`docker exec ... printenv`) e reescrevendo
`postgres.env`/`stack.env` com os valores corretos. **Nenhum dado foi
perdido**, mas ficou confirmado: `.harness/state/*.env` guarda credenciais
de infraestrutura, não histórico de sessões — uma limpeza seletiva futura
(itens 12/13 abaixo) tem de os poupar sempre.

Também foi descoberta uma migração legada (`legacy_session_migrations`) que
reimportou 113 sessões antigas a partir de um `sessions.json` que ainda
existia no momento da primeira truncagem; só ficou definitivo depois de
`.harness/state/sessions.json` deixar de existir e de truncar outra vez
(confirmado por reinício do backend sem repetir a migração).

### Estado final (verificado)
Postgres 0/0/0 linhas · MinIO 0 objetos · `.harness/` vazio (6.2MB só de
estado novo pós-arranque) · sessão do ChatGPT intacta (268MB) · stack
`healthy` em todos os serviços.

### Efeito colateral transitório (resolvido)
Logo a seguir à correção das credenciais, o utilizador criou um novo
projeto e recebeu `Falha no planeamento: session not found` ao enviar uma
mensagem, apesar do Postgres já estar vazio/estável e o backend a
responder normalmente. Um novo `make build && make stop && make start`
resolveu — o mais provável é a janela do Electron ter ficado com uma
ligação/estado em cache do exato momento em que o backend ainda estava a
ciclar pelas credenciais erradas antes da correção. Não recorrente depois
do restart completo.

### Nota — outro armazenamento de artefactos ainda não limpo
`GET /api/config` mostra `remote_input.instances[].usage.stored_objects`
com valores não-nulos (9/40/31) — este é um armazenamento **separado** do
bucket MinIO `wharness-artifacts` que limpei (parece ser o armazenamento
remoto usado pelos túneis trycloudflare/ngrok para inputs, possivelmente
`HARNESS_REMOTE_STORAGE_*`/rclone). Não foi tocado nesta limpeza. Fica
para a funcionalidade de limpeza seletiva (secção 12) incluir esta fonte
também.

## 11. Nova norma de projeto — sempre container, nunca dependência do host

Adicionado `AGENTS.md` secção 11 ("Host-independence / containerized
tooling invariant", v1.2.44) — **não** ao `CLAUDE.md`, que proíbe registar
regras de projeto. Resumo: qualquer tarefa de lifecycle/build/manutenção/
limpeza (incluindo `make build`, o futuro `make clean`, e qualquer
funcionalidade de limpeza na app) deve correr o trabalho real dentro de um
container, nunca depender de uma ferramenta instalada no host — mesmo que
essa ferramenta esteja presente. Quando for preciso um CLI sem equivalente
containerizado, a resposta é criar uma imagem de ferramentas dedicada ou
reutilizar o binário já embutido num serviço a correr (como fiz com o `mc`
do MinIO), nunca recorrer ao binário do host.

## 12. Por fazer — funcionalidade de limpeza seletiva na app

Pedido: uma nova funcionalidade de limpeza nas Definições, com âmbito
selecionável:
- **Global** (todos os projetos) vs **Projetos** (selecionar quais).
- **Chats** — todos ou selecionados.
- **Logs de execução** — todos ou selecionados.
- Outros artefactos criados (bundles, contexto, etc.).
- Por padrão deve **sempre tentar manter sessões, projetos e configurações**
  — o resto (chat, bundles, logs) é para matar.

Ainda por desenhar e implementar. Tem de:
- Correr sempre via container (norma da secção 11) — nunca assumir `mc`,
  `psql`, etc. no host da máquina onde o backend corre.
- Poupar sempre as credenciais de infraestrutura (`.harness/state/*.env`) —
  lição direta do incidente da secção 10.
- Ter uma contraparte em CLI: `make clean` (limpeza total ou seletiva),
  mesma regra de "sempre container".

## 13. Novo dead-end descoberto e corrigido — incompatibilidade de toolchain do host no build de auto-evolução

Terceiro caso do mesmo padrão da secção 2 (Go module cache) e distinto dele:
o build real do Wharness no host (`make build-stage`, disparado por
`selfevolution.BuildHost` durante `ApplyToHost`) falhava com
`Error [ERR_REQUIRE_ESM]` / `Electron failed to install correctly` porque o
Node do host (`v20.15.1`) é mais antigo do que o exigido pelo Electron fixado
em `services/desktop/package.json` (`>=22.12`). Nenhum patch de código pode
corrigir isto — é uma propriedade do host, não do projeto — mas o caminho de
falha de `ApplyToHost` (tanto o automático em `runAutomaticPlan` como o
manual via `TriggerApplyFailureRepair`) não tinha qualquer classificação para
este caso e despachava sempre um pedido de reparação ao ChatGPT, gastando uma
tentativa (`RepairAttempt`) num pedido que o modelo estruturalmente não pode
satisfazer. Confirmado ao vivo na sessão `ses_20260906T205749_3cbb4c18308fcf61`.

Corrigido:
- `domain.FailureKindHostBuildToolchain` — nova classificação, paralela a
  `FailureKindOfflineGoModuleCache`.
- `selfevolution.ErrHostBuildToolchainMismatch` + `IsHostToolchainMismatch`
  — reconhece os marcadores `ERR_REQUIRE_ESM` e
  `Electron failed to install correctly` na saída capturada de
  `BuildHost`, deliberadamente estreito (não usa `EBADENGINE`, que é apenas
  aviso e aparece em builds bem-sucedidos).
- `classifyExecutionFailure` estendido para reconhecer o novo sentinel.
- Guarda central em `prepareRepairRequest` (único ponto, cobre os dois
  chamadores — automático e manual): qualquer causa classificada como
  infraestrutura publica `automation.infrastructure_blocked`, marca
  `FailureKind` e **nunca** consome uma tentativa de reparação nem cria
  pedido ao ChatGPT.
- `sessionFailureKind` ganhou o mesmo fallback de prosa legado que o caso Go
  já tinha, para que a sessão já presa nesse estado seja reclassificada
  assim que este código for implantado.
- Frontend: `AgentWorkspace.tsx` mostra um aviso informativo, não-acionável
  ("Build do host bloqueado — Node do host incompatível — sem correção via
  ChatGPT") em vez de expor um botão de retry que não existe para este caso
  (ao contrário do caso Go, aqui não há ação que o Wharness possa conceder).

Testado: `internal/selfevolution` (2 testes novos), `internal/app` (2 testes
novos/estendidos), `AgentWorkspace.test.tsx` (1 teste novo) — suite completa
Go e Vitest verde.

**Por fazer, arquitetural** (não implementado ainda, alinhado com a norma da
secção 11): `make build-stage` corre `npm ci`/`npm run build` para
frontend/desktop diretamente com o Node do host (`scripts/build-cache.sh`,
`scripts/deps-cache.sh`) — nada aqui está containerizado. A correção acima
apenas classifica e para de desperdiçar pedidos ao ChatGPT quando isto
acontece; a correção estrutural que elimina esta classe de erro por completo
é mover esses passos para um container com Node fixado, tal como já é a
norma para o resto do projeto. Ainda por desenhar.

## 14. Segundo dead-end descoberto e corrigido — sessões antigas presas em nome de bundle "system"

Analisando o mesmo chat em ping-pong (`5f300daff16c`), duas rondas de
reparação seguidas falharam com `Falha de protocolo/comunicação: Bundle
pertence ao chat system, mas o chat ativo é 569f235d-...`. Causa raiz: a
sessão em causa (`ses_20260906T205749_3cbb4c18308fcf61`) foi criada **antes**
da propagação de `chat_id` (secção B2 do plano original) ficar em produção,
por isso `Session.ChatID` ficou vazio para sempre — nada no código voltava a
preenchê-lo depois. Toda a nomeação de bundle de pedidos derivados (reparação)
cai então no placeholder `"system"`, que nunca pode coincidir com o chat real
do Desktop — um impasse permanente e determinístico para qualquer sessão
criada antes dessa migração, gastando tentativas de reparação (e pedidos
reais ao ChatGPT) sem nenhuma hipótese de sucesso.

Corrigido:
- Novo endpoint `PUT /api/sessions/{id}/chat-id` (handler `chatID` em
  `server.go`, delega no `SetChatID` já existente, que já validava o
  formato) — permite re-preencher o `chat_id` de uma sessão já existente.
- Frontend: novo `useEffect` em `App.tsx` (par do de despacho de
  reparação/conflito) que detecta `session.chat_id !== activeChatId` e
  chama `api.setChatId` uma única vez por sessão (deduplicado por
  `chatIdBackfillRef`), sem tocar em mais nenhum estado.
- `types.ts` ganhou o campo `chat_id` que já vinha do backend mas nunca
  tinha sido declarado no tipo `Session`.

Testado: `internal/app` (1 teste novo), Vitest (1 teste estrutural novo);
`go build`/`tsc --noEmit`/suites completas verdes.

**Ainda por investigar/resolver** (mesmo chat, mesma transcrição): depois de
corrigidos os dois problemas acima, a 3ª tentativa de reparação expôs um
terceiro problema, mais profundo — `host apply failed: host apply blocked by
stale baseline: plan plan_req_20260906T210037_agent_commandbar_layout was
verified on adc93027bf2b... but current baseline is 5f300daff16c...`
(`reason_code: stale_pending_baseline`). Ao contrário dos dois casos acima,
este não é uma falha de classificação nem de nomenclatura: há uma fila de
alterações Protected pendentes (`PendingHostChanges`) e a **primeira** da
fila tem um baseline que já não pode ser avançado por
`canFastForwardPlanBaseline`/`canFastForwardBaseline` (nem pela via de
patch-only `requestSnapshotDelta`), o que bloqueia o Apply de toda a fila
atrás dela. O próprio ChatGPT, na 3ª resposta, diagnosticou correctamente
que o protocolo de reparação actual não tem **nenhuma operação** para
retirar/rebasear esse candidato pendente obsoleto — só sabe propor planos
novos. Isto é uma lacuna estrutural genuína (não uma correcção pequena) e
fica registada aqui para decisão de prioridade, em vez de ser tentada às
pressas por baixo de outro trabalho já aprovado (a fonte de conhecimento
incremental, secção 15).

**Decisão do utilizador**: não implementar nenhum dos dois agora (sessão com
tokens quase esgotados) — ambos ficam registados aqui para retomar depois.

**Resolvido estruturalmente na secção 22**: o `stale_pending_baseline`
descrito acima era um sintoma do mecanismo CAS/ChangeSet — um candidato
pendente "obsoleto" não tinha nenhuma operação de recuperação. A migração
para integração Git nativa (secção 22) elimina esta classe de impasse por
construção: um candidato pendente obsoleto passa a ser um merge conflict
Git normal, tratado pelo mesmo caminho `harness.conflict/v1` já existente —
nunca mais um beco sem saída sem operação de recuperação.

## 15. Entregue — fonte de aprendizado incremental por projecto

Pedido do utilizador: cada projecto acumula uma fonte de conhecimento
persistente, escrita pelo próprio ChatGPT, com este ciclo de vida: nada muda
durante o trabalho normal; só depois de um Apply bem-sucedido o WHX manda
UMA ronda extra com o histórico completo do pedido (requests/responses,
planos, comandos+exit codes, correcções, bloqueios, permissões) + o
conhecimento actual, perguntando se há algo a reter (ChatGPT não é
obrigado a responder); pode incrementar, corrigir, consolidar ou reescrever
por completo; o resultado é enviado na primeira requisição de cada chat
novo desse projecto. Dois refinamentos pedidos a meio da implementação:
(a) a ronda final tem também de devolver, sempre, um resumo de tudo o que
foi feito desde o pedido principal até esta ronda de consolidação — não só
o conhecimento novo; (b) a listagem de ficheiros alterados só deve aparecer
no chat junto desse resumo final, nunca antes, para não fragmentar o
relatório em vários avisos soltos.

Implementado por completo, seguindo o plano aprovado
(`/home/zootakuxy/.claude/plans/elabore-o-plano-minuncioso-glittery-plum.md`):

- **`internal/domain/types.go`**: `ProjectKnowledge` (Postgres, por
  `project_path`, substituição completa de documento — não há histórico de
  versões, só o contador); `Session.PendingKnowledgeReviewRequestID`
  (independente de `state`, de propósito — a sessão já está correctamente
  em `applied`/`restart_pending` quando esta ronda dispara, e não há
  "estado real" a restaurar depois); `ExecutionBundleInfo.ProjectKnowledgeUpdate`.
- **`internal/executionbundle/bundle.go`**: extrai `knowledge.md` opcional
  da raiz do bundle (cap 256 KiB), tal como já faz para `README.md` —
  puramente transporte, sem qualquer acoplamento a `turn.Kind`.
- **`internal/session/`**: `harness_project_knowledge` na schema Postgres;
  `GetProjectKnowledge`/`AppendProjectKnowledge` (upsert com incremento de
  versão), com o mesmo padrão dual-mode Postgres/memória já usado pelo
  resto do `*Store`.
- **`internal/planner/`**: `Request.KnowledgeSource`; `BuildManualPrompt`
  ganha uma secção `PROJECT KNOWLEDGE` (só quando não vazio) e um desvio
  cedo para `buildKnowledgeReviewPrompt` quando `PlanningMode ==
  "knowledge_review"` — um prompt dedicado, sem qualquer contrato
  CHANGE/WORKFLOW, que exige um relatório final obrigatório em
  `turn.message` (trabalho realizado por ficheiro, resumo, próximos
  passos, conhecimento adquirido) e um `knowledge.md` opcional (documento
  completo, nunca diff).
- **`internal/app/service_knowledge.go`** (novo): `triggerKnowledgeReview`
  (best-effort, nunca toca em `State`/`Plan`/`Policy`/`LastExecution`) e
  `ingestKnowledgeReviewResponse` (único caminho de código que alguma vez
  lê `ProjectKnowledgeUpdate` — é isto que torna o invariante "só actualiza
  no fecho" uma propriedade do código, não uma convenção). Disparado nos 3
  pontos já marcados por `closeRemoteInputChannel(sessionID,
  "request.completed")`. `SubmitExecutionBundle` ganhou um desvio cedo
  activado por `RequestLineage.Kind == "knowledge_review"`, que salta toda
  a máquina de baseline/workflow/repair (não se aplica — esta ronda nunca
  carrega plano). `SubmitMessageWithMode` inclui `KnowledgeSource` só
  quando `len(item.RequestLineages) == 0` (primeira requisição do chat).
- **Frontend**: `types.ts` ganhou `chat_id`... (já existia) e
  `pending_knowledge_review_request_id`; novo `useEffect` em `App.tsx`,
  paralelo ao de despacho de reparação/conflito mas chaveado neste campo
  novo em vez de `session.state`, reaproveitando
  `transportPlannerContinuation` sem qualquer UI nova — o relatório final
  do ChatGPT aparece como uma mensagem de chat normal porque
  `ingestKnowledgeReviewResponse` grava `LastTurn`, e o mecanismo que já
  renderiza `session.last_turn.message` como balão de chat (usado por
  qualquer resposta `answer`) trata este caso sem alterações.
- **Documentação**: `SoT/AI_PROTOCOL.md` (nova secção v1.4),
  `SoT/AUTOMATION_BUNDLE.md` (`knowledge.md` como ficheiro de bundle
  reconhecido), `adr/ADR-0028-incremental-project-knowledge.md`,
  `CHANGELOG.md`.
- Testado: `internal/executionbundle` (3 testes), `internal/session`
  (4 testes, incluindo um gated por `WHARNESS_TEST_DATABASE_URL` para o
  caminho Postgres real), `internal/planner` (4 testes), `internal/app`
  (5 testes), frontend (1 teste estrutural). Suites completas Go e Vitest
  verdes (194 testes Vitest).

**Por fazer, fora de âmbito do V1** (conforme o plano original): transporte
via API OpenAI directa; UI dedicada em Definições para ver/editar/repor o
documento; histórico versionado de conteúdos passados.

## 16. Causa raiz definitiva do ping-pong "real" — lock de auto-evolução órfão com `pid=1`

Analisado a partir do ZIP de exportação do chat
`64623e2c-6674-4d07-a593-2f48491cec96` (o `774dc75049e2` referido pelo
utilizador é o prefixo do **baseline sha256** actual, não um chat id) e do
estado em disco de `.harness/self-evolution/`.

**Estado encontrado**: `stage.lock` com o conteúdo literal
`pid=1 / created=2026-09-06T21:54:25Z`, `active.lock` inexistente, `status`
em `phase=prepared` desde as 21:54, e 3 candidatos Protected verificados na
fila (`default_agent_chat_split`, `window_scoped_agent_chat_width`,
`integration_race_chat_id_ref`), todos com ChangeSet e todos com a
verificação de integração a passar (lint + 28 testes + build às 00:11).

**Mecanismo exacto do impasse permanente**:
1. `prepareNewBatch` escrevia o `stage.lock` via `acquireLock`, que só
   registava `pid=` — sem `run_id=` (ao contrário do `active.lock`, escrito
   por `acquireActiveLock`, que já registava ambos).
2. O backend corre como **PID 1** dentro do seu container. `syscall.Kill(1, 0)`
   responde sempre "vivo" — para este processo e para todos os backends
   futuros, porque cada um deles também é o PID 1.
3. Logo `activeLockOwnerAlive` classificava o lock órfão como "vivo" para
   sempre: `acquireLock` nunca o reclamava e devolvia `ErrBusy`.
4. Em `Prepare`, o ramo que falha a obter o `stage.lock` remove o
   `active.lock` que acabara de criar e devolve `ErrBusy` — o que explica o
   `active.lock` ausente e o `stage.lock` eterno.
5. Resultado: **todos** os Apply de auto-evolução falhavam com
   `another Wharness self-evolution transaction is already active`, e cada
   falha pedia uma correcção ao ChatGPT que nunca poderia libertar um
   ficheiro de lock local → ping-pong sem fim (o "ping pong real").

**Correcções implementadas** (`internal/selfevolution/manager.go`):
- `acquireLock` passa a gravar `run_id=<runtimeInstanceID>` além do `pid`,
  tal como `acquireActiveLock` — é isso que torna o lock reclamável depois
  de um crash ou restart.
- `activeLockOwnerAlive` deixa de consultar o `pid`: decide exclusivamente
  pelo `run_id`. Um lock **sem** `run_id` é, por construção, anterior a
  este build e portanto obsoleto (e o seu `pid` não é confiável, pela razão
  do ponto 2). Um lock com `run_id` diferente continua obsoleto; só o
  `run_id` desta instância bloqueia. Isto faz o impasse curar-se sozinho
  em qualquer reinício, sem intervenção manual.
- 3 testes de regressão novos, incluindo a reprodução literal do estado de
  produção (`pid=1`, sem `run_id`) e a garantia de que a exclusão mútua real
  (lock desta instância) continua a bloquear.

**Desbloqueio imediato**: o `stage.lock` órfão foi removido do disco (cópia
em scratchpad), pelo que o backend em execução — ainda com o código antigo —
já consegue aplicar. Os 3 candidatos continuam verificados e íntegros.

**Notas para o próximo Apply**:
- O Node do host foi entretanto actualizado para v22.20.0 e o Electron está
  correctamente instalado, pelo que a falha `ERR_REQUIRE_ESM` da secção 13
  já não se aplica ao `make build-stage`.
- Nenhum ficheiro tocado por esta correcção pertence aos ChangeSets
  pendentes (só `internal/selfevolution/*`), para não introduzir conflitos
  de integração nesses candidatos.

**Fica por fazer** (deliberadamente adiado para não colidir com a fila
pendente, que altera `AgentWorkspace.tsx`): um aviso acionável no frontend
para `failure_kind` de bloqueio local (`self_evolution_transaction_busy`,
`host_integration_race`) que diga "candidato verificado — repetir aplicação"
em vez de aparecer como erro genérico. Hoje o backend já classifica estes
casos (e já não gasta rondas de ChatGPT com eles), mas a UI ainda os mostra
como erro comum, o que continua a convidar o utilizador a devolvê-los ao
ChatGPT sem necessidade.

## 17. O Node do build de auto-evolução é o do CONTAINER, não o do host

Depois de desbloqueado o lock da secção 16, o Apply avançou até ao fim
(`Aplicação no host iniciada`, 5 × `changeset.integrated`) e falhou no
`BuildHost` com o mesmo `ERR_REQUIRE_ESM` do Electron — reportando
`node: 'v20.15.1'` **apesar de o host ter v22.20.0**. É por isso que
`make build && make stop && make start` feitos à mão não resolviam: são dois
Node diferentes.

**Causa raiz**: `services/backend/Dockerfile` assentava em
`golang:1.23.0-alpine3.20`, cujo `apk add nodejs` dá **Node 20.15.1**. O
`BuildHost` corre `make build-stage` dentro do próprio container do backend
(é intencional — o comentário do Dockerfile di-lo: "keep the build/control
toolchain in this container"), logo usa o Node do container. O Electron
fixado (`electron@44.1.1`) exige `>=22.12`. Resultado: o operador compila à
mão com o seu Node 22 (nvm) e passa; a auto-evolução compila com o Node 20
do container e falha sempre — uma divergência invisível de fora e que
nenhum patch de código pode corrigir.

**Correções implementadas**:
- `services/backend/Dockerfile`: base passa a `golang:1.23-alpine3.21`
  (Node **v22.23.2**, Go 1.23.12) nas duas fases, com um comentário a
  explicar que a release do Alpine é *load-bearing* e deve acompanhar o
  requisito do Electron fixado. Imagem construída e verificada.
- `scripts/deps-cache.sh`: novo `require_supported_node`, chamado
  imediatamente antes de qualquer `npm ci`. Abaixo de 22.12 falha de
  imediato com a versão encontrada, o caminho do `node` em uso e a
  indicação explícita de que um build de auto-evolução usa o Node do
  container — em vez do stack trace de 60 linhas do `install.js` do
  Electron, que não nomeia nem o Node nem o requisito. Verificado nos dois
  sentidos (falha em alpine3.20/Node 20, passa em alpine3.21/Node 22).

**AÇÃO NECESSÁRIA**: a correção só produz efeito depois de a imagem do
backend ser reconstruída — `make build` (que faz `stack-build`) e reiniciar
o stack. Enquanto o container em execução tiver o Node 20, o próximo Apply
volta a falhar exactamente da mesma maneira.

## 18. Comandos de verificação repetidos em looping numa única tentativa

O utilizador reparou que "os mesmos comandos são rodados várias vezes antes
de falhar". Confirmado: `stageHostIntegration`
(`internal/app/service_changeset.go`) corria os gates de verificação de
**cada candidato pendente** contra o **mesmo** workspace integrado. Com 3
candidatos a repetirem `npm run typecheck`, `npm run lint` e `npm run build`,
cada um desses corria 3×, ~12 execuções e ~2,5 min de trabalho duplicado por
passagem — e tudo outra vez em cada nova tentativa de Apply.

**Correção**: novo `dedupedIntegrationVerifications`, que achata os gates de
todos os candidatos no conjunto que realmente tem de correr, com identidade
`argv + cwd` (o mesmo gate é o mesmo gate independentemente do timeout ou do
envelope de exit codes que um plano posterior lhe tenha escrito). O primeiro
candidato que declara um gate fica dono dele, o que mantém a comparação de
baseline ancorada ao prefixo mais pequeno — e portanto mais conservador.
2 testes novos, incluindo o caso em que nada se repete e o caso `cwd`
diferente (que continua a ser um gate distinto).

## 19. Alinhamento automático do Node do host via nvm (pedido explícito do utilizador)

Depois da correção da secção 17 (Node do *container* do backend), o
utilizador levantou um ponto distinto, sobre o `make build` invocado
directamente pelo humano no host: em vez de só falhar com uma mensagem clara
quando o Node do host está desactualizado, o Wharnex deveria tentar
**alinhar automaticamente** a versão, usando `nvm` (já presente no host,
confirmado: `~/.nvm` com várias versões instaladas) para subir
temporariamente para uma versão compatível — e só falhar de facto se isso
não for possível. O próprio utilizador reconheceu que isto é uma excepção
deliberada à norma da secção 11 ("menos dependência de host, tudo em
container"), justificada porque `nvm` é uma ferramenta de host inerentemente
pessoal/interactiva, sem equivalente containerizado sensato *para este fim*
(escolher qual Node o shell interactivo do operador usa) — ao contrário das
CLIs auxiliares que essa norma obriga a containerizar.

**Implementado** em `scripts/deps-cache.sh`:
- `node_version_satisfies_minimum` — extraído do antigo `require_supported_node`
  para poder ser chamado antes e depois da tentativa de alinhamento.
- `try_nvm_alignment` — corre via `bash -c` explícito (nvm.sh não é POSIX
  `sh`, e o script mantém o shebang `sh`), procura entre as versões já
  instaladas do operador (`nvm ls`) a mais recente que satisfaça o mínimo, e
  só instala uma nova (`nvm install --lts`) se nenhuma já instalada servir.
  Nunca instala o próprio nvm, nunca corre dentro de um container (self-
  evolution nunca alcança este fallback: a imagem do backend já satisfaz o
  mínimo directamente, corrigido na secção 17).
- `require_supported_node` — verifica o Node do `PATH`; se insuficiente,
  tenta o alinhamento e, em caso de sucesso, põe o `bin/` resolvido pelo nvm
  à frente do `PATH` só para o resto desta execução do script (sem tocar em
  `.bashrc`/perfis persistentes) e prossegue; só falha, com a mesma mensagem
  clara de antes, se o nvm não estiver disponível ou não encontrar/instalar
  nada que sirva.
- Verificado isoladamente nos dois sentidos: com Node 20.19.5 forçado no
  `PATH`, alinha para v22.20.0 já instalada via `nvm use` e passa; sem
  `NVM_DIR` válido, falha com a mensagem clara e `exit 1`.
- `AGENTS.md §11` actualizado (v1.2.45) com esta excepção registada
  explicitamente, para não parecer uma violação silenciosa da norma.

## 20. Confirmação: o Apply seguinte funcionou de facto (banner "incompatível" era estado obsoleto)

O utilizador reportou que, mesmo depois de corrigido o Node, a UI continuava
a mostrar "Build do host bloqueado — Node do host incompatível". Verificado
ao vivo: o `failure_kind` mostrado vinha de uma tentativa **anterior**
(21:16), e entretanto — com a imagem do backend já reconstruída — uma NOVA
tentativa (01:17:05–01:18:38) **completou com sucesso**:
`self_evolution.host_build_completed` → `host.applied` →
`self_evolution.restart_pending` → `restart_scheduled`, com os 3 candidatos
pendentes aplicados (`pending_host_changes` passou a 0) e `failure_kind`
limpo. O backend reiniciou (`docker ps` confirmou o container novo,
healthy). Não havia bug adicional aqui — era só a UI ainda a mostrar o
resultado da tentativa antiga até a nova terminar. Sem acção necessária.

## 21. Logs em tempo real do build de auto-evolução (pedido explícito do utilizador)

Pedido recorrente nesta sessão (já identificado antes como lacuna, agora
implementado): o cartão "Build do Wharness no host" ficava mudo — sem
qualquer log — até o build terminar (sucesso ou falha), o que lia como um
bloqueio mesmo quando estava só a decorrer (`npm ci`/`vite build`/`go build`
podem demorar minutos).

**Implementado**, seguindo exactamente o padrão já existente para comandos
de sandbox (`sandbox.StreamingRunner`/`streamCapture`, que já publica
`command.output` por bloco em tempo real):
- `internal/selfevolution/manager.go`: `BuildHost` ganhou um parâmetro
  `onOutput BuildOutputCallback`, e um novo `buildOutputWriter` que escreve
  simultaneamente no buffer acumulado (para a classificação de erro
  existente) e invoca o callback por cada bloco recebido de stdout/stderr.
- `internal/app/service.go`: o único ponto de chamada publica
  `self_evolution.host_build_output` (`{stream, text, transaction_id}`) por
  cada bloco — o mesmo mecanismo SSE (`/api/sessions/{id}/events`, já com
  `flusher.Flush()` por evento) que já entrega `command.output` ao vivo.
- `lib/executionTimeline.ts`: novo agrupamento por `transaction_id`
  (`self_evolution.host_build_started/output/completed/failed`), no mesmo
  molde do agrupamento por `run_id` de `command.*` — a mesma entrada
  expansível de log ao vivo, não um mecanismo novo. Os dois casos mortos
  em `statusMeta` (`started`/`completed` sem agrupamento) foram removidos,
  substituídos por este agrupamento.
- `components/Inspector.tsx`: `terminalEvents` passou a incluir também
  `self_evolution.host_build_output` e `self_evolution.host_build_failed`
  (só `started`/`completed` estavam listados antes).
- Testado: `internal/selfevolution` (1 teste novo, confirma stdout/stderr
  chegam ao callback à medida que são produzidos, não só no fim);
  `lib/executionTimeline.test.ts` (2 testes novos — sucesso com log
  acumulado, e falha preservando o log já recebido). Suites completas Go e
  Vitest verdes (193 testes).

## 22. Entregue — integração sandbox→host nativa em Git (novo protocolo principal)

Pedido explícito do utilizador, na sequência de mais uma ocorrência ao vivo
do erro `host changed repeatedly during ChangeSet integration: external
write race on ...`: substituir por completo o mecanismo de integração
CAS/ChangeSet (`internal/changeset`) por Git real — "o wharnex faz
alterações em sandbox e commita em uma branch diferente... quando for para
integrar no host, ela faz o merge dessa branch para a branch do host...
sem necessariamente comitar para o repositório principal". O utilizador
declarou isto **"o nosso protocolo principal de integração e comunicação"**
daqui em diante.

Descoberta decisiva: `internal/sandbox/copy.go` já clona o `.git` real do
projecto (`git clone --local --no-hardlinks`, via `cloneGitBaseline`)
sempre que o host é um repositório Git — o que é sempre o caso, garantido
por `internal/projectgit.Ensure`. O histórico real do host já estava
disponível dentro do sandbox; faltava apenas comitar o patch verificado
numa branch e, do lado do host, fazer um merge Git real em vez de escrever
ficheiros por compare-and-swap manual.

**Fluxo entregue** (ver `SoT/SANDBOX_MODEL.md`, `SoT/AI_PROTOCOL.md`,
`SoT/AUTOMATION_BUNDLE.md`, `AGENTS.md` e `adr/ADR-0029-git-native-sandbox-host-integration.md`
para o contrato normativo completo):
1. Verificação sandbox bem-sucedida → `git commit` numa branch
   `whx/<request_id>`, autor fixo `Wharness <wharness@localhost>`,
   mensagem = `commit_message` do plano (agora obrigatório para `change`
   no protocolo), sanitizada, com trailers `Request-Id`/`Plan-Id`.
2. Push local (nunca remoto) dessa branch para o `.git` real do host.
3. Merge real (`git merge --no-ff --no-edit`) na branch do host, com
   verificação pós-merge reaproveitando os mesmos comandos de verificação
   do plano, agora via `s.hostRunner`.
4. Conflito de merge real → aborta e devolve o mesmo capsule
   `harness.conflict/v1` já existente, agora alimentado por `git show` nas
   SHAs do merge-base/host/branch em vez de conteúdo de `ChangeSet`.
5. Falha de verificação pós-merge → reversão automática (`git reset --hard`
   para o HEAD pré-merge; decisão do utilizador).
6. Sucesso → elimina a branch de integração (decisão do utilizador: os
   commits/merge permanecem no log do host de qualquer forma).

Um caso permanece na via legada CAS/`ChangeSet`: candidatos reconciliados a
partir de um arquivo ZIP imutável (`reconcileFromArchive`, quando o baseline
do host avançou e o candidato só pode ser reverificado contra a base
arquivada) não têm ancestralidade Git real partilhada com o host — nesse
caso não há branch para commitar/fazer merge, e o caminho
`materializePlanChangeSet` original é preservado inalterado.

**Correcções durante a implementação** (ver histórico de commits para
detalhe): garantir HEAD resolvível em projectos Git recém-criados
(`ensureInitialCommit` em `internal/projectgit`); auto-commitar estado não
rastreado do host antes do merge para não confundir ficheiros não
rastreados comuns com um conflito real; encadear correctamente candidatos
pendentes sequenciais (replay da branch já integrada do candidato anterior
antes de aplicar o seguinte); usar `git fetch <caminho> branch:branch`
explícito em vez de depender de `origin/<branch>`, porque
`configureSandboxGitRemotes` remove o remoto `origin` transitório do clone
quando o projecto real não tem remotos configurados; e um bug introduzido
durante a própria migração — o snapshot base usado pelo caminho
`reconcileFromArchive` estava a ser tirado **depois** do patch já aplicado
(diff vazio, resultando na tentativa incorrecta de reverify por patch bruto
contra a árvore do host), corrigido movendo o snapshot para antes do loop
de operações do plano.

Testado: `internal/sandbox/gitintegration_test.go` (novo — commit, push
local, merge limpo, merge com conflito real estruturado, reversão exacta,
eliminação de branch); suite completa `internal/app` (incluindo o teste que
expôs o bug do snapshot, `TestStaleBundleWithOverlappingLocalChangePreparesDedicatedConflictResolution`);
`go vet`/`go build`/`go test ./...` e `tsc --noEmit`/`vitest run` (49
ficheiros, 195 testes) verdes.

## 23. Análise profunda do ping-pong + fiabilidade DOM + modo Manual — entregue (A-D) e backlog registado (E)

Pedido do utilizador depois de nova ocorrência ao vivo do "external write race": análise
profunda de 4 problemas críticos — #1 ping-pong que nunca termina, #2 reload indevido dos
chats, #3 péssima integração DOM com o ChatGPT (ficheiros duplicados, downloads perdidos,
submits silenciosamente falhados), #4 novo modo de transporte de chat "Scraper" (actual,
corrigido) vs "Manual" (o Wharness deixa de tocar no DOM do ChatGPT; entrega prompt para
copiar e recebe o bundle por upload manual). Consolidado num único plano de execução depois
de o utilizador ter sinalizado alterações paralelas a meio do planeamento.

### Entregue e verificado (Go completo + Vitest completo + Node/Desktop completo, sempre verdes)

**Frente A — bug estrutural do rollback de self-evolution a ignorar o git**: `Transaction.Rollback`
(`internal/selfevolution/manager.go`) restaurava ficheiros por cópia bruta sem verificar se o
git HEAD tinha avançado por trás (um merge de integração não relacionado a decorrer entre o
`Prepare` e o `Rollback`) — descoberto num incidente real documentado em `VALIDATION.md`.
Corrigido: `Prepare` capta agora o SHA do git antes de comitar (`PreTransactionSHA`), e
`Rollback` recusa (`ErrRollbackUnsafe`) se detectar sobreposição entre os ficheiros que ia
restaurar e o que mudou entretanto, em vez de sobrescrever silenciosamente. 2 testes novos
reproduzindo o cenário exacto.

**Frente B — limite de tentativas de resolução de conflito**: o caminho de conflito de merge
Git descoberto dentro de `ApplyToHost` (e os 2 ramos de repetição em `failExecution`) nunca
passava pelo contador `RepairAttempt`, podendo pedir resolução automática ao ChatGPT
indefinidamente em modo Auto. Novo campo dedicado `ConflictAttempt` (não reaproveita
`RepairAttempt`, que mede uma coisa diferente), protegendo os 5 pontos de entrada através de
um único ponto de correcção partilhado (`exhaustConflictResolution`) nas duas funções que já
preparam o capsule de conflito. Novo estado terminal `conflict_resolution_exhausted`. 2 testes
novos.

**Frente C — fiabilidade da automação DOM do Desktop**:
- C1: `submitChatGPTDraft` (`services/desktop/main.mjs`) devolvia `{accepted:false}`
  silenciosamente em 7 de 9 pontos de chamada em vez de falhar. Corrigido para usar
  `submitWithRetry` (já existente em `chatgpt-input.mjs`, nunca importado) internamente — só
  uma função a mudar, não os 7 pontos de chamada (todos já tratam correctamente uma excepção).
- C2: `pollExpectedChatGPTDownloadKey` reclicava o download por cooldown de tempo sem guard de
  "já em curso", produzindo downloads duplicados (Chromium desambigua com sufixo `(1)`/`(2)`,
  que o código já aceitava). Novo `downloadInFlight` + deduplicação por `requestId` com TTL.
- C4: `pollChatGPTVisibleActivity` sondava o DOM em plena navegação pós-reload (faltava o
  guard `entry.loading` que `pollExpectedChatGPTDownloadKey` já tinha), acumulando falhas e
  disparando um segundo reload em cima do primeiro.
- Detecção de "ChatGPT está a pensar" (`chatgpt-dom.mjs`) dependia só do botão
  `data-testid="stop-button"`; qualquer mudança desse detalhe na interface do ChatGPT fazia o
  Wharness interpretar uma resposta longa como parada e recarregar a meio do raciocínio.
  Reforçada com selectores alternativos + a classe `.result-streaming`, sinal independente do
  botão específico.
- 5+ testes de regressão novos.

**Frente D — novo `ChatTransportMode` (Scraper/Manual)**: campo novo per-chat (domínio +
serviço + endpoint HTTP `PUT /api/sessions/{id}/chat-transport-mode` + tipos/API/toggle no
frontend), independente de `AutomationMode` (Auto+Manual é combinação válida). Painel novo
`ManualChatGPTPane` (upload de bundle por drag-and-drop, extrai `request_id` do nome do
ficheiro via novo `lib/bundlename.ts`) reaproveitando `onBundleFile` já existente mas nunca
ligado a nenhuma UI. Dois níveis de garantia "não tocar no DOM": primário em `App.tsx` (nunca
chama `preparePrompt`/`transportPlannerContinuation` em modo Manual), defesa em profundidade no
Desktop (`chatgptTransportModes`, 3 guards). ~15 testes novos entre backend/frontend/desktop.

**Bug adicional encontrado e corrigido durante a verificação em produção**: uma superfície de
resolução de conflito usa sempre um `cacheKey` `<chat_id>_cf_<conflict_id>` (com `_`), mas o
esquema de nomes de bundle proíbe `_` no segmento do chat_id (é o separador do próprio
esquema) — qualquer ficheiro real descarregado do ChatGPT tem esse `_` trocado por `-`. A
validação `canonicalWharnessBundleDownload` (`services/desktop/security.mjs`) comparava o
`chat_id` já sanitizado do nome do ficheiro directamente contra o `cacheKey` cru, sem
sanitizar este último primeiro — por isso **qualquer** conflito, mesmo com um único chat
activo, falhava sempre com "Bundle pertence a outro chat". Corrigido para sanitizar os dois
lados antes de comparar. **Exige reiniciar a app Wharnex Desktop** para entrar em vigor (só
backend/frontend foram reconstruídos e reconciliados via `make build`).

**Frente E item 1** — aviso frontend accionável para bloqueio local de self-evolution
(`self_evolution_transaction_busy`/`host_integration_race`): já classificado no backend desde a
secção 16, mas a UI ainda mostrava erro genérico. Novo banner "Candidato verificado — repetir
aplicação" (botão real, chama `onApply`), substituindo a confusão de "preciso mandar isto ao
ChatGPT outra vez" quando na verdade é só repetir o Apply.

**Frente E item 7** — cores de mensagem por remetente: já existia uma diferenciação subtil
(tons de cinza quase idênticos entre ChatGPT e Wharness) que passava despercebida; agora
ChatGPT tem tom azulado e Wharness tom esverdeado, genuinamente distintos, claro e escuro.
Corrigida de caminho uma regra duplicada em `theme.css` que anulava silenciosamente a cor do
ChatGPT no modo escuro.

### ❌ Por fazer — Frente E, backlog ainda por implementar

| Item | Estado |
|---|---|
| Item 2 — containerizar `make build-stage` (Go/Node fixos via `docker run`, AGENTS.md §11) | **Desenhado e parcialmente verificado**: `docker/build/Dockerfile` criado (Go 1.23 + Node 22, testado manualmente com sucesso para o build do backend). Makefile foi alterado e depois **revertido de propósito**: o host ficou sob pressão severa de memória a meio da verificação (chegou a 12,6GB/15GB usados, 8GB de swap), fazendo `docker build` bloquear indefinidamente em vez de falhar — se tivesse ficado no Makefile real, o `make build-stage` do self-evolution podia bloquear para sempre nessas condições. Retomar quando o host tiver memória livre para terminar a verificação em isolamento antes de voltar a tocar no Makefile. |
| Item 3 — Fase C do protocolo (consolidar `TurnKind`, `request` tipado, intenções de alto nível, skills, execução fora do sandbox) | Precisa de âmbito confirmado antes de começar; nunca começou. |
| Item 4 — Renomeação completa Wharness → Wharnex | Precisa de âmbito confirmado antes de começar (módulo Go inteiro, volumes/imagens Docker já em produção, env vars, `whaness.yml`). |
| Item 5 — Editor: 3 modos (editor/preview/split), split genérico, terminal agêntico com múltiplos terminais | Não iniciado; projecto grande por si só. |
| Item 6 — Funcionalidade de limpeza selectiva na app + `make clean` equivalente | Não iniciado; projecto grande por si só. |
| Item 8 — Modal de arquivado mostrar a conversa ChatGPT ao lado | Adiado por escolha explícita do utilizador (exigiria embutir webview ao vivo; não existe transcript bruto guardado). |
| Item 9 — Varredura exaustiva do tema "verde escuro" (hardcodes fora do "chrome visível" já auditado) | Adiado por escolha explícita do utilizador. |

### Nota operacional

Ao longo desta sessão, sempre que se confirmou concorrência activa perigosa no mesmo
repositório (outra sessão de self-evolution a mudar os mesmos ficheiros ao mesmo tempo que
este trabalho), as sessões do projecto foram pausadas para `automation_mode=manual` como
contenção temporária — mas qualquer chat novo nasce sempre em `auto` por omissão, pelo que o
número de sessões em auto cresce sozinho com o tempo (20 no momento de fechar esta sessão,
depois de várias pausas). Isto não é tratado como bug — é o comportamento esperado do produto
— mas fica registado para quem retomar não presumir que a pausa é permanente.

Verificação final antes de fechar esta sessão: `go build`/`go vet`/`go test ./...` (backend
completo), `npm run typecheck`/`lint`/`test -- --run` (52 ficheiros, 227 testes), `node --test`
(Desktop, 140+ testes) — todos verdes. Existem alterações por commitar no repositório
(Frente E itens 1 e 7, mais trabalho de outra sessão paralela já terminado nos mesmos
ficheiros) — nenhum commit foi pedido nesta sessão.


wdwdw
dw
dwd
dwdw
