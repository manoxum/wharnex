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
