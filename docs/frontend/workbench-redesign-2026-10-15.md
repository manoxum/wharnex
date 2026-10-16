# Reformulação do workbench — 15 de outubro de 2026

## Arquitetura e implementação

A auditoria foi feita sobre o código e o estado inicial da árvore de trabalho.
Não havia um vídeo anexado acessível nesta sessão. As decisões normativas estão
em `SoT/WORKBENCH_DESIGN.md` e `adr/ADR-0099-cohesive-workbench-experience.md`.

As causas tratadas foram a distribuição concorrente das ferramentas, a mistura
de configuração e conversação, os cabeçalhos independentes, a exposição permanente
de detalhes operacionais e a cascata CSS que anulava migrações para Tailwind.

| Área | Mudanças implementadas |
| --- | --- |
| Contexto global | Identidade do projeto em primeiro plano; branch com largura limitada; pesquisa e paleta de comandos acessíveis; indicadores secundários discretos |
| Navegação | Uma barra esquerda por defeito, agrupada em desenvolvimento, inteligência e ferramentas; personalizações existentes preservadas; lado direito auxiliar |
| Painéis | Cabeçalhos partilhados; opções de texto e atualização agrupadas; recolha, redimensionamento e restauração; sobreposição contextual em janelas estreitas |
| Espaço principal | Editor prioritário; documentos, conversas e divisões existentes preservados; pesquisa abre a posição exata no ficheiro |
| Documentos | Lista de documentos abertos e estados de gravação preservados; reorganização por arrasto ou Alt+Shift+Setas; ordem guardada pelo mecanismo existente |
| Agente e compositor | Configuração separada da ação de enviar; contexto e ferramentas num controlo identificado; automação, esforço e transporte disponíveis progressivamente |
| Permissões | Protected, Unprotected, Full e permissões nativas continuam explícitos, com os mesmos callbacks, restrições e autorizações |
| Codex | Conversação, consumo e configuração separados; conta guardada, carregamento e ligação efetiva distinguidos; sem convite incorreto de primeiro acesso |
| Operações | Pesquisa, origem, métricas e estados vazios no centro de tarefas; FIFO e concorrência numa secção expansível; histórico e ações existentes preservados |
| Git | Comparação com lista filtrável de ficheiros e Monaco real; inline/lado a lado; rótulos antes/depois; revisão e confirmação distintas; janela estável entre fases |
| Painel inferior | Terminal, Problemas e Saída de execução com separadores comuns; seleção por projeto; terminal mantido montado; saída combina histórico durável e eventos atuais |
| Pré-visualização | Janela de ficheiros mais legível e ampliável, mantendo edição e gravação otimista; estados vazios partilhados |
| Monitor de navegadores | Tema e controlos comuns; URL informativa; colunas contextuais adaptáveis; modo ampliado reversível; diagnóstico e legenda progressivos |
| Definições | Categorias estáveis, pesquisa e seletor em janelas estreitas; páginas comuns de aparência, idioma, compositor, workspace, limites e dados |
| Ligações | Introdução, catálogo, gravação e estado de reinício comuns a túneis e armazenamento; erro de carregamento com repetição explícita |
| Recursos | Cabeçalhos harmonizados para agentes, biblioteca, conhecimento, Docker, base de dados, erros e gestão de conversas |

## Componentes e contratos reutilizáveis

- `presentation/workbench`: Button, IconButton, Input, Select, Field, Switch,
  NumberStepper, PanelHeader, StatusBadge, EmptyState e ControlPopover.
- `workspace/window/chrome`: WindowPanelHeader compõe os controlos reais de
  minimizar, maximizar, restaurar e fechar, sem duplicar o botão de fechar.
- `workspace/shell`: navegação agrupada, paleta de comandos, gestão de layout,
  opções dos painéis e OperationalWorkbench com ferramentas carregadas por procura.
- `editor/canvas`: navegação, ordenação de documentos, toolbar de comparação e
  carregamento de documentos de diff isolados por ficheiro e sessão.
- `git/review`: DiffReviewFrame partilhado por revisões e alterações da worktree;
  seleção, preparação, revisão e progresso compostos na mesma janela.
- `project/settings`: SettingsPage, SettingsGroup, SettingsFrame e a apresentação
  comum das ligações; formulários separados por responsabilidade.

Os novos componentes usam os tokens do tema e a escala de texto persistida.
Controlos partilham estados de foco, desativação e transições breves, com respeito
por movimento reduzido. Popovers de formulário usam navegação normal por Tab,
fecham com Escape e devolvem o foco ao controlo de origem. A paleta mantém o foco
dentro do diálogo e executa apenas a ação escolhida.

## Continuidade e segurança

- Não foram alterados protocolos, permissões, execução Protected, autenticação,
  operações Git, isolamento dos navegadores ou transporte do PTY.
- As ações visuais continuam ligadas aos handlers existentes. A confirmação Git
  permanece explícita; uma mudança de fase não confirma a operação.
- O modo de concentração e a recolha do painel inferior escondem as superfícies.
  Não fecham terminais, descartam documentos ou substituem o layout guardado.
- A saída operacional usa o mesmo ledger durável das vistas de execução; o
  desaparecimento do resultado no snapshot não apaga o histórico apresentado.
- A paleta chama ações frontend nomeadas e APIs de pesquisa existentes. A abertura
  a partir do shell valida a origem e a janela pai; não oferece RPC genérico.
- O monitor conserva a instância nativa selecionada. Políticas e confirmações
  ficam ao lado da página nativa; não é criado um canal de navegação ou reload.
- A administração de dados mantém a frase exata de confirmação e as confirmações
  do Desktop. Métricas indisponíveis são distintas de utilização igual a zero.
- Os campos secretos dos providers, limpeza de credenciais e operações de
  autenticação conservam os contratos existentes.

## Compatibilidade e refatoração

Não há migração de base de dados ou alteração de dependências da aplicação.
Preferências e identificadores persistidos existentes continuam válidos. A nova
organização só é a predefinição para instalações sem layout guardado ou após a ação
explícita de restaurar. Arrasto, fixação e ordenação de barras personalizadas
continuam disponíveis.

Novas preferências usam o prefixo Wharnex e guardam apenas apresentação: seleção
da ferramenta inferior e painéis do monitor. As grafias antigas do bridge,
chaves já publicadas, prefixo remoto rclone e imagem base de ferramentas são
mantidas nas respetivas fronteiras de compatibilidade.

A passagem de refatoração extraiu as responsabilidades tocadas, consolidou
cabeçalhos e formulários, eliminou o ramo visual inutilizado de ArtifactToggle e
removeu as regras dedicadas dos componentes migrados. A ordem da cascata e os
consumidores não migrados de seletores partilhados foram preservados.

Exceções de migração declaradas:

- Geometria e tratamento visual dos separadores de terminais, projetos, conversas
  e documentos, conforme `SoT/TABS.md`; faixa Agent continua apenas com ícones.
- Regras globais de elementos e mecânica partilhada de arrasto/dock de janelas;
  as novas primitivas usam utilitários importantes no seu próprio limite.
- DOM de Monaco, Quill e xterm, controlado pelas respetivas bibliotecas.
- Formulários internos de providers e inspeção de contexto que continuam a servir
  contratos partilhados; nesta alteração migram a composição e o chrome tocados.

Dívida técnica remanescente identificada: as responsabilidades não tocadas de
App, ChatPanel, EditorWorkspace, GitDrawer, ProjectSettings, TunnelProviderSettings,
ProjectTasksDrawer, AgentRuntimeDrawer, DockerServicesPanel e ArtifactExplorerPanel
ainda estão em ficheiros legados acima do limite. Os novos módulos extraídos
respeitam 200 linhas e não alargam diretórios já sobrelotados. Não foi feita uma
reescrita das restantes responsabilidades desses ficheiros.

O trabalho anterior no editor, explorador e estilos foi usado como base. As
preferências tipográficas, os componentes de contexto/documentos e a árvore já
existentes foram conservados; não foram revertidos para HEAD.

## Validação

Os resultados finais e a atribuição de falhas constam de
`workbench-validation-2026-10-15.json`, ao lado deste relatório. A comparação usa
o estado inicial, incluindo alterações locais que já existiam, e não apenas HEAD.

| Verificação | Resultado |
| --- | --- |
| Typecheck e build de produção | Passaram |
| Vitest completo | 1 352 passaram; 63 falharam, as mesmas falhas de base em 42 ficheiros |
| Comparação com a base | 56 testes adicionais; zero novas falhas identificadas após mapear uma alteração de nome de teste |
| Passagem final de extração | 52 testes passaram; sem falhas |
| Layout, ordenação e composição operacional | Nove testes focados passaram; sem falhas |
| Chromium | 12 cenários passaram; sem falhas |
| Lint | Os mesmos três erros iniciais de Drawio; zero erros novos e zero avisos |
| Estrutura e tamanho novos | 135 ficheiros introduzidos, máximo de 175 linhas; zero novas violações de domínio |
| Diff | Sem erros de whitespace |

O build conserva o aviso existente de chunks superiores a 500 kB. Não foi
alterado o limiar do aviso. Os sete ficheiros não adicionados ao Git que já
existiam no início não entram na contagem de 116 introduzidos nesta alteração.

Verificações executadas em contentores:

```text
npm run typecheck
npm run lint
npm test -- --run
npm run build
npx playwright test --config=e2e/workbench/ux.config.ts
node scripts/quality/domain-layout.mjs
sh scripts/check-file-size.sh HEAD
git diff --check
```

O lint global tinha inicialmente três erros em Drawio, fora desta alteração.
O gate de estrutura já falhava em três diretórios backend: app (291 ficheiros),
sandbox (66) e uitesting/httpapi (21). Estes problemas não foram corrigidos
alterando verificações ou funcionalidades alheias à reformulação.

A contagem adicional de todos os novos ficheiros confirma o limite de 200 linhas
e o máximo de 20 ficheiros nos seus diretórios. O script de tamanho, isoladamente,
não expande todos os diretórios novos não adicionados ao Git.

Chromium verifica temas claro/escuro, janelas de 600/720/1280/1440 px, escala de
125%, menus e foco, paleta, estado vazio, rascunho do compositor, ordenação e
persistência de documentos, definições, painel inferior e comparação/confirmação
Git. Os diffs usam o Monaco e os workers da distribuição de produção. As imagens
geradas em `services/frontend/test-results/` foram inspecionadas visualmente.

Os testes de navegador usam dados locais e um terminal explicitamente identificado
como fixture sem acesso ao host. A preservação do terminal real é coberta pelos
testes existentes do TerminalWorkspace/InteractiveTerminal e pelo teste de
continuidade da composição. Não foram enviados comandos para um PTY humano,
usadas contas reais, executadas operações Git remotas ou capturadas páginas de
navegadores autenticados. Não se infere uma garantia de todos os percursos reais
apenas destes cenários automatizados.

## Refinamento da Fase 2

A segunda passagem conserva a composição e as preferências do workbench. O
popover partilhado mede o botão de origem e o conteúdo, alinha pela margem mais
próxima, abre para cima quando há mais espaço e limita a altura à janela. Os
menus nativos recebem as cores da paleta IDE ativa em todas as áreas.

No painel de agentes, atividade, vínculo, tarefa, estado, memória e navegador
ficam na primeira leitura; lineage, tentativas, lease, residência e tempos de
execução estão reunidos em «Detalhes da execução». O grupo mantém os valores
originais e os atalhos para abrir o chat e focar o projeto. A lista de evolução
usa pintura adiada nos eventos e conhecimento fora do ecrã, conservando cada
registo, a ordem, os filtros e a seleção individual.

Quando o pool partilhado apresenta um agente ocupado noutro projeto, a vista
mostra a identidade desse projeto e a ocupação genérica, sem expor tipo, IDs,
erro, conversa ou página da tarefa alheia. A seleção e os dados locais do
projeto atual continuam completos.

Na validação desta passagem, o build de produção e o typecheck passaram; 42
testes focados, o teste específico de paleta nativa, o lint dos ficheiros tocados
e os 13 cenários Chromium passaram. O build mantém o aviso preexistente de
chunks acima de 500 kB. A regressão completa de paletas ainda reporta a
expectativa antiga de estilos de bundles numa folha agregadora; a verificação
dos seletores nativos passou. A tentativa de repetir a suite Vitest completa
não terminou com um resumo após cerca de dois minutos e foi interrompida; a
referência da Fase 1 continua a ser 1 337 testes aprovados e as mesmas 63 falhas
existentes na base.

O compositor agora usa superfícies de 32 px para motor e modelo, com texto e
ícones mais legíveis; a faixa mantém as opções avançadas e o envio existentes.
No Codex, o estado vazio acompanha a ligação real: não pede autenticação se o
runtime já está ligado e distingue verificação, desconexão, indisponibilidade e
erro. O indicador do runtime é a fonte de verdade mesmo quando a identidade da
conta ainda não chegou.

Nesta continuação passaram 25 testes focados de Codex e compositor, typecheck,
lint dos ficheiros tocados e build. Os 13 testes Chromium do workbench passaram.
Na suite Chromium do Codex, 7 de 11 passaram; os quatro restantes expõem duas
expectativas antigas de `box-shadow: none` perante o reset Tailwind e duas
expectativas de encontrar o seletor de contas na conversa, embora esteja na
categoria «Configuração». Esses pontos já pertenciam à composição anterior e
não foram alterados nesta continuação.

O estado vazio do TODO agora apresenta a ação «Registar uma ideia» dentro do
contexto inicial e abre o compositor existente. Os outros filtros mantêm as
suas mensagens específicas e o FAB continua disponível quando a ação não está
no estado vazio inicial. Durante a primeira consulta, uma mensagem de estado
real substitui o vazio prematuro; o atalho de criação continua disponível. O
espaçamento, scroll e alinhamento da lista passaram para utilitários Tailwind;
as regras CSS dessa lista foram removidas.

Na validação desta pequena alteração passaram o typecheck, o lint dos ficheiros
tocados, os dois testes novos de carregamento/estado vazio e o build. O build
mantém o aviso existente de chunks acima de 500 kB. O teste completo do painel
ainda falha na verificação antiga de arquivamento: o teste espera «Arquivar
TODO» e uma aba «Arquivados», mas a versão base do componente em `HEAD` já não
contém essa ação nem essa aba. O código desta alteração não modificou o fluxo
de arquivamento; a expectativa não foi removida nem enfraquecida.

Na biblioteca, os cartões de bundles passaram de quadrados para uma proporção
mais baixa e adaptável. O nome tem maior prioridade e os metadados de projeto,
tamanho e data ficaram mais legíveis; tipo e direção usam etiquetas separadas,
sem reutilizar a cor de sucesso para identificar uma resposta. A grelha e os
cartões foram extraídos para `library/cards/`, as ações passaram pelos botões
partilhados e os estilos antigos desses cartões foram substituídos por Tailwind.
Pesquisa, filtros, paginação, seleção múltipla, abertura, download, indexação e
confirmações de eliminação continuam nos mesmos fluxos.

Os 7 testes do painel e o novo teste visual dos cartões passaram, assim como o
typecheck, o lint dos ficheiros tocados, o build e `git diff --check`. O build
continua a avisar sobre chunks acima de 500 kB. O teste agregador
`operational-visuals.test.ts` ainda falha na expectativa `.evidence-metric`; a
busca no `HEAD` confirma que a própria regra CSS dessa classe já estava ausente.
Essa falha não pertence à alteração da biblioteca. Não foi feita validação
visual via navegador neste incremento.

No detalhe dos agentes, a indicação de ocupação por outro projeto passou para
Tailwind e para a escala tipográfica do painel. O aviso continua explícito e
mantém a identidade do projeto, sem revelar informações da tarefa alheia. A
regra CSS antiga foi removida. Os três testes focados de detalhe e privacidade,
o typecheck, o lint dos ficheiros tocados, o build e `git diff --check` passaram.
O build mantém o aviso existente de chunks acima de 500 kB; não foi feita nova
validação de navegador nesta alteração.

Na lista de eventos de auto-evolução, a montagem foi limitada a blocos de 100
eventos e conhecimentos, com ação explícita para revelar o bloco seguinte. A
ordem cronológica inversa mantém-se. «Selecionar resultados» continua a abranger
todos os resultados filtrados, mesmo os que ainda não foram montados; o estado
da seleção sobrevive à pesquisa. O payload técnico só é serializado ao abrir
«Dados», e o índice de pesquisa por evento é reutilizado entre alterações do
termo. O limite de 2 000 eventos do serviço permanece inalterado.

Os seis testes focados desta lista passaram, incluindo paginação, ordem,
seleção, pesquisa, cache do índice e expansão diferida dos dados; também
passaram typecheck, lint, build e `git diff --check`. Na suite completa, a
repetição estruturada terminou com 1 352 aprovados e 63 falhas em 42 ficheiros,
igualando as 63 falhas da base. O teste `operational-visuals.test.ts` foi
renomeado ao mover as asserções da biblioteca; continua a falhar na mesma regra
`.evidence-metric` ausente na base. Uma primeira execução reportou 64 falhas,
mas essa falha adicional não reapareceu na repetição; não foi atribuída a esta
alteração. Não foi feita uma nova validação visual por navegador nesta etapa.

O catálogo de conhecimento do projeto passou a usar proporções limitadas para
a navegação e utilitários Tailwind para a composição responsiva. A lista mantém
um mínimo de 190 px e um máximo de 320 px; abaixo de 520 px do painel ou 820 px
da janela, navegação e leitura passam a ocupar linhas próprias. Registos,
explicações e documentos Markdown usam uma escala legível e uma largura de
leitura confortável, respeitando a preferência de tamanho da interface. O item
selecionado expõe o estado atual também a tecnologias de apoio. Pesquisa,
filtros, conteúdo, tradução, atualização e consolidação permanecem no mesmo
fluxo. As regras antigas específicas do catálogo foram removidas; ficou apenas
o estilo da barra de tradução partilhada com o leitor.

Na validação do catálogo passaram os três testes do painel, o typecheck, o lint
dos ficheiros alterados, o teste de migração visual, o build e `git diff
--check`. O build mantém o aviso existente de chunks acima de 500 kB. A execução
conjunta do teste de consolidação também reproduziu uma falha já registada na
base: a asserção da paleta do terminal procura cores diretamente em
`InteractiveTerminal`, embora a implementação use `activeTerminalTheme`. Não
foi feita validação visual por navegador nesta etapa.

No monitor do navegador, a grelha agora distribui larguras por tipo de painel e
reserva espaço para uma área central de navegação. Ao abrir Políticas, os
detalhes cedem largura antes da lista; ao alternar manualmente para um painel
que não cabe junto do outro, o painel não selecionado recolhe temporariamente.
As preferências persistidas continuam a restaurar-se quando a janela volta a
ter largura suficiente. Os painéis e o próprio conteúdo central aceitam largura
mínima zero, evitando que texto técnico provoque overflow da grelha.

Passaram os 10 testes focados do monitor, o typecheck, o lint dos ficheiros
alterados, o build e `git diff --check`. O build mantém o aviso existente de
chunks acima de 500 kB. A suite integral terminou com 1 353 testes aprovados e
63 falhas em 42 ficheiros, mantendo as 63 falhas da execução de referência
anterior; esta execução incluiu mais um teste aprovado. Foram também reportadas
quatro rejeições não tratadas em `OrchestratorWorkspace.test.tsx`, devido a
mocks sem `closeInteraction`; esse fluxo não foi alterado nesta etapa. Não foi
feita inspeção visual manual da vista Electron nativa nesta alteração.
Depois da suite integral, a restauração das preferências ao fechar Políticas
foi reforçada; os testes focados, typecheck, lint pontual e build passaram na
versão final. `npm run lint` completo mantém três erros já registados na base,
nos ficheiros `DrawioPreview.test.tsx` e `drawioModel.ts`; nenhum pertence ao
monitor do navegador.

O seletor de modelo do ChatGPT agora calcula a abertura do popover pela área
livre junto ao controlo, limita largura e altura à janela e recalcula a posição
em resize e scroll. Em janelas estreitas, o menu encolhe até à largura
disponível e mantém as opções percorríveis. A descoberta dos modelos continua
dependente de gesto explícito; seleção confirmada, estados de erro e atalhos de
teclado mantêm o mesmo comportamento.

Os quatro testes de geometria e os 13 testes do controlo passaram. Também
passaram typecheck, lint dos ficheiros alterados, build e `git diff --check`.
O build mantém o aviso existente de chunks acima de 500 kB. A suite completa
terminou com 1 358 testes aprovados e 63 falhas em 42 ficheiros, mantendo as 63
falhas da base; os quatro erros não tratados de `OrchestratorWorkspace` por
mocks sem `closeInteraction` também se repetiram. O lint global mantém os três
erros conhecidos de Drawio. Uma inspeção visual Electron não foi feita nesta
alteração.

O popover partilhado agora conserva a referência do estado de posicionamento
quando resize ou scroll recalculam a mesma geometria e escala tipográfica. Isso
evita renderizações dos controlos e do conteúdo interno sem alteração visível;
as regras de abertura, foco e fecho mantêm-se intactas.

Os sete testes focados passaram, assim como typecheck, lint dos ficheiros
alterados, build e `git diff --check`. A suite completa terminou com 1 359
testes aprovados e 63 falhas em 42 ficheiros, o mesmo número de falhas da base;
os quatro erros não tratados de `OrchestratorWorkspace` por mocks sem
`closeInteraction` repetiram-se. O lint global mantém os três erros conhecidos
nos ficheiros de Drawio. O build mantém o aviso existente de chunks acima de
500 kB. Não foi feita inspeção visual Electron nesta alteração.

No painel de Agentes, o estado operacional deixou de carregar uma mensagem de
erro numa linha truncada. O diagnóstico permanece visível num bloco compacto,
com quebra de linhas e contraste semântico; o âmbito de privacidade de projetos
continua a suprimir os detalhes de instâncias ocupadas noutro projeto.

Os três testes de `AgentRuntimeDetails`, typecheck, lint pontual e build
passaram. A suite integral terminou com 1 360 testes aprovados e 63 falhas em
42 ficheiros, mantendo as 63 falhas anteriores e os quatro erros não tratados
de mocks sem `closeInteraction` em `OrchestratorWorkspace`. O lint global
continua com os três erros conhecidos de Drawio. O build mantém o aviso de
chunks acima de 500 kB. Não foi feita inspeção visual Electron nesta alteração.

O seletor de documentos abertos do Editor foi extraído para o subdomínio de
separadores e passou a renderizar num portal fora da faixa com `overflow-hidden`.
O menu alinha-se ao botão, escolhe a direção vertical com o posicionador
partilhado, respeita os limites da janela e mostra o documento ativo ao abrir.
Escape fecha e devolve o foco; clique exterior fecha o menu; a seleção mantém o
caminho completo no título e conserva o destaque do ficheiro ativo. A lista
ficou mais legível com tipografia operacional maior; não foram alteradas as
ações ou a persistência dos separadores.

Os dois testes focados passaram, assim como typecheck, lint pontual, build e
`git diff --check`. A suite completa terminou com 1 362 aprovados e 63 falhas em
42 ficheiros, mantendo o número de falhas da base e quatro rejeições não
tratadas dos mocks sem `closeInteraction` em `OrchestratorWorkspace`. O lint
global continua com três erros existentes nos ficheiros de Drawio. O build
mantém o aviso de chunks acima de 500 kB. Não foi feita inspeção visual na
janela Electron nesta alteração.

Os menus de ficheiros abertos e execuções recentes do Editor agora usam o
mesmo `ControlPopover`. Ambos são portados para fora de áreas com clipping,
escolhem a posição dentro dos limites da janela e preservam fecho por Escape,
clique exterior e foco. O menu de documentos mantém a seleção do ficheiro ativo;
o menu de execuções conserva os comandos e o callback que os encaminha para o
terminal. O menu de execuções alinha pela margem direita do botão, e os comandos
longos continuam acessíveis pelo título completo.

Passaram os nove testes focados de posicionamento e dos dois menus, o typecheck,
o lint dos ficheiros alterados, o build e `git diff --check`. A suite integral
terminou com 1 364 aprovados e 63 falhas em 42 ficheiros; os nomes das 63 falhas
coincidem com a base registada e repetiram-se quatro rejeições dos mocks sem
`closeInteraction` em `OrchestratorWorkspace`. O lint global permanece bloqueado
pelos três erros existentes em Drawio. O build mantém o aviso de chunks acima
de 500 kB. A asserção independente da paleta do terminal continua a falhar no
teste adjacente de estilos. Não foi feita inspeção visual na janela Electron.

Os controlos nativos agora herdam o esquema de cor da raiz ativa: menus de
opções e campos do sistema acompanham o tema claro ou escuro, inclusive fora de
Definições. Mantive os `<select>` nativos e os seus comportamentos de teclado;
a mudança limita-se à indicação de tema que o navegador usa para os controlos
do sistema operativo.

O teste isolado do esquema nativo passou, assim como typecheck, lint do teste,
build e `git diff --check`. A suite completa de regressão de temas passou 18
testes e manteve uma falha baseline na asserção dos tons de bundle do cabeçalho
integrado. O build continua a emitir o aviso existente de chunks acima de
500 kB. Não foi feita inspeção visual Electron nesta alteração.

Na vista de tarefas, a pesquisa e o filtro por origem agora partilham uma faixa
adaptativa: ficam lado a lado quando cada controlo dispõe de pelo menos 11 rem
e empilham em painéis compactos. O grupo recebeu um nome acessível; os rótulos,
opções e comportamento dos filtros mantêm-se.

O teste focado, lint dos ficheiros alterados, typecheck, build e `git diff
--check` passaram. Confirmei também que o build inclui a regra `auto-fit` no
CSS produzido. O build mantém o aviso existente de chunks acima de 500 kB.

Na lista de Tarefas do projeto, os estados vazios agora ficam verticalmente
centrados no espaço disponível. A regra só se aplica quando não há cartões de
tarefa; se uma atualização falhar mas houver cartões já carregados, a lista
mantém o alinhamento no topo. O estado vazio é marcado pelo `EmptyState`
partilhado, sem alterar conteúdo, filtros ou paginação.

O teste focado, lint dos ficheiros alterados, typecheck, build e `git diff
--check` passaram. Confirmei no CSS gerado o seletor Tailwind condicionado pelo
estado vazio e pela ausência de cartões. O build mantém o aviso existente de
chunks acima de 500 kB.

Na lista de Tarefas do projeto, um estado vazio agora recebe alinhamento
vertical centralizado no espaço de trabalho. O padrão só ativa quando o
`EmptyState` está presente como conteúdo direto da lista; cartões carregados
continuam a começar no topo. A mesma apresentação cobre as vistas históricas e
mensagens de erro que usam o componente partilhado, sem tocar na paginação ou
no conteúdo das tarefas.

O teste focado, lint dos ficheiros alterados, typecheck, build e `git diff
--check` passaram. Confirmei no CSS produzido que o seletor `:has()` do Tailwind
foi compilado. O build mantém o aviso existente de chunks acima de 500 kB.

Na barra superior, os modos do workspace passam para uma segunda linha até 900
px, deixando a identidade do projeto e os indicadores operacionais na primeira.
A grelha estreita agora acompanha a regra responsiva prevista, sem perder
altura para os controlos. O launcher, notificações, alertas de execução, Git e
configuração mantêm-se disponíveis. Abaixo de 640 px, os indicadores podem
passar a mais de uma linha em vez de comprimirem os controlos.

O teste da composição responsiva, o lint pontual, typecheck, build e `git diff
--check` passaram. O build conserva o aviso existente de chunks acima de
500 kB. A apresentação não foi inspecionada na janela Electron.

No painel de detalhes de Agentes, os valores operacionais e de diagnóstico
deixam de ser truncados: podem quebrar em várias linhas e ser selecionados para
cópia. Rótulos e valores usam 13 px escaláveis, preservando os mesmos campos,
links para chat/projeto e a expansão dos detalhes técnicos.

Passaram os testes focados do painel e da privacidade entre projetos (4/4),
ESLint pontual, typecheck, build e `git diff --check`. O build mantém o aviso
existente de chunks acima de 500 kB; a inspeção visual Electron ainda não foi
feita.

Os detalhes visíveis da instância estão agora agrupados por Atividade, Sessão e
Instância. Os dados operacionais frequentes ficam no primeiro plano e os
identificadores de execução continuam dentro da secção expansível. A separação
mantém os valores completos selecionáveis e não expõe detalhes da tarefa de
outro projeto.

Os testes focados de apresentação e privacidade passaram (4/4), assim como
ESLint pontual, typecheck, build e `git diff --check`. O CSS compilado inclui a
tipografia e as regras de quebra de linha. O aviso existente de chunks grandes
mantém-se; não fiz inspeção visual na janela Electron.

No Dossiê de evolução, cada evento apresenta agora o resumo operacional e o
estado através do mesmo mapeamento usado no histórico de execução. Categoria,
tipo técnico, projeto, data e hora continuam visíveis; detalhes adicionais
permanecem expansíveis. A renderização adiada dos cartões fora do ecrã mantém
todos os registos, controlos de seleção e paginação acessíveis.

Os dois testes focados, ESLint pontual, typecheck, build e `git diff --check`
passaram. Confirmei que o build inclui as utilidades Tailwind de renderização
adiada e tamanho intrínseco. O aviso existente de chunks acima de 500 kB
mantém-se; não fiz inspeção visual na janela Electron.

Confirmei que o Wharnex não estava a usar Lucide: o componente central desenhava
um conjunto próprio de paths SVG. Substituí esse desenho manual por `lucide-react`
no adaptador `Icon`, mantendo todos os nomes públicos, tamanhos e locais de uso.
Os ícones passam a partilhar o mesmo viewBox, traço e terminais arredondados;
agente e IA usam símbolos distintos. A mudança acrescentou cerca de 4,9 kB
comprimidos ao chunk do Explorer no build local.

O teste do contrato visual Lucide, ESLint pontual, typecheck e build passaram;
`git diff --check` passou. Não fiz inspeção visual na janela Electron. O build
mantém o aviso existente de chunks acima de 500 kB.
