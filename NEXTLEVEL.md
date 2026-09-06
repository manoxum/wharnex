# NEXTLEVEL — registo desta sessão

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
| Exportar chat para ZIP de análise | Nova funcionalidade, ainda por desenhar e implementar |
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

## 15. Por fazer — fonte de aprendizado incremental por projecto (plano aprovado, não implementado)

Pedido do utilizador: cada projecto acumula uma fonte de conhecimento
persistente, escrita pelo próprio ChatGPT, com este ciclo de vida: nada muda
durante o trabalho normal; só depois de um Apply bem-sucedido o WHX manda
UMA ronda extra com o histórico completo do pedido (requests/responses,
planos, comandos+exit codes, correcções, bloqueios, permissões) + o
conhecimento actual, perguntando se há algo a reter (ChatGPT não é
obrigado a responder); pode incrementar, corrigir, consolidar ou reescrever
por completo; o resultado é enviado na primeira requisição de cada chat
novo desse projecto.

Plano completo já desenhado e **aprovado** pelo utilizador em modo de
planeamento — ver
`/home/zootakuxy/.claude/plans/elabore-o-plano-minuncioso-glittery-plum.md`
para o desenho detalhado (armazenamento Postgres por projecto via extensão
do `session.Store` existente; documento viaja como ficheiro opcional
`knowledge.md` na raiz do bundle de resposta, nunca como campo JSON; só é
lido pelo serviço dentro de um branch dedicado activado por
`RequestLineage.Kind == "knowledge_review"`, nunca por uma resposta normal;
estado da sessão nunca é tocado pela ronda de revisão — usa um campo novo
`pending_knowledge_review_request_id` independente de `state`; 3 pontos de
disparo, todos já marcados no código por
`closeRemoteInputChannel(sessionID, "request.completed")`). **Nenhum código
foi escrito ainda para esta funcionalidade** — só o plano existe. Retomar a
partir desse ficheiro de plano quando houver disponibilidade.
