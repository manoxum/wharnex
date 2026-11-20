# Wharnex — revisão da IDE, 2026-10-16

## Alterações implementadas

- Terminal, Problemas e Saída de execução têm entradas de atividade próprias.
  O host operacional desaparece por completo quando recolhido, preservando a
  instância do terminal, as ligações e os processos. O docking inferior/direito,
  as alturas e as larguras são guardados por projeto e ferramenta. Em centros
  estreitos, o docking passa temporariamente para baixo sem apagar a preferência.
- Problemas apresenta erros e avisos reais do Monaco, com pesquisa, contagens,
  origem e localização navegável. Erros de execução continua a apresentar o
  histórico estruturado de incidentes de runtime, incluindo a distribuição e
  as ações existentes. A Saída mantém o histórico durável e acrescenta filtros
  por texto, origem, nível e data UTC; a filtragem não reescreve a timeline.
- Os documentos mantêm os separadores partilhados, Git, autosave, separação e
  destacamento de superfícies. A densidade Normal usa 36px e Compacta 32px;
  as etiquetas têm 12px escaláveis, com os limites de largura já existentes.
  A lista de documentos abertos tem pesquisa por caminho e indicação de edição.
- O menu de contexto opera sobre o documento clicado: fechar atual, outros,
  todos ou à direita, fixar/desafixar, copiar caminhos, revelar no explorador e
  reabrir o último documento fechado. O botão central fecha o documento.
  Os fechos em lote respeitam os fixados e o grupo da superfície. Uma única
  decisão Guardar / Não guardar / Cancelar protege os rascunhos; uma falha de
  gravação, uma edição posterior ou uma mudança de sessão mantém o lote aberto.
- As duas barras de atividades usam a mesma geometria de 48px, ícones de 19px,
  grupos regulares, indicadores de seleção, foco e badges. A ordem, o lado e
  a fixação continuam a usar o mecanismo de personalização existente.
- A aparência rápida usa o popover partilhado, ancorado e limitado à janela,
  com tema, destaque e densidade aplicados imediatamente e persistidos.
  As opções de conteúdo e colocação das barras foram preservadas.
- As confirmações comuns e as decisões de fecho/recuperação do Desktop usam
  superfícies compactas com tokens, gestão de foco, proteção durante operações
  assíncronas e ações semânticas. Os diálogos imperativos preservam também as
  funções existentes de mover, redimensionar e minimizar.
- O Workspace Switcher inclui pesquisa, caminhos completos em tooltip,
  favoritos persistidos, projetos desta janela, outras janelas e recentes.
  A abertura, ativação e desvinculação reutilizam os fluxos existentes. Remover
  dos recentes não elimina ficheiros. O explorador e os documentos partilham
  o mesmo componente de menu contextual.
- Cabeçalhos e estados vazios partilhados ficaram mais compactos. A mudança
  propaga-se aos consumidores existentes, incluindo Agentes, Docker, Conhecimento,
  UI Lab, Biblioteca e Database Studio. Não foram substituídos os módulos
  funcionais desses painéis.

## Componentes e arquitetura

A implementação concentra-se em `components/workspace/shell/operations`,
`workspace/shell/navigation`, `workspace/shell/chrome/projects`,
`workspace/shell/appearance`, `editor/canvas/tabs` e nos componentes de
apresentação `menus`, `dialogs` e `workbench`. A lógica de fecho de documentos,
a apresentação dos diálogos imperativos e o seletor de projetos foram extraídos
para módulos com responsabilidades próprias. Os ficheiros novos respeitam o
limite de 200 linhas e os diretórios de domínio não excedem 20 ficheiros.

Não há alterações aos contratos backend/Desktop, ao protocolo de execução,
a permissões ou à gestão do PTY. A normalização das barras acrescenta as novas
ferramentas preservando as colocações guardadas. As preferências novas são
aditivas; as chaves de compatibilidade existentes mantêm-se.

A migração Tailwind limita-se às superfícies alteradas. As regras legadas
correspondentes foram removidas, incluindo variantes de tema. Monaco, xterm,
Quill e as superfícies de execução/revisão não alteradas conservam o seu estilo
existente; são limites explícitos da intervenção, não uma migração global.

## Validação e limites

Os testes abrangem decisões sobre rascunhos, falhas de gravação, pinning,
âmbito dos lotes, histórico, cópia/revelação de caminhos, pesquisa, foco,
filtragem dos eventos, projetos, persistência e geometria das ferramentas.
A validação de navegador cobre claro/escuro, Normal/Compacta, diagnósticos reais
Monaco, preservação da instância de terminal, docking, recarga e dimensões de
700 a 1920px nos cenários de painéis existentes. Os testes de recursos e
navegação dos separadores partilhados também foram executados.

Problemas mostra as fontes de diagnóstico disponíveis no Monaco; não lança
por si um linter ou compilador externo. As falhas desses comandos continuam
acessíveis em Saída e Erros de execução. Não foi introduzida substituição
implícita de documentos por separadores temporários: a pré-visualização de
conteúdo existente continua disponível sem descartar documentos editados.

A suite global e o lint têm falhas anteriores à intervenção. A atribuição foi
feita contra uma cópia da revisão original, sem relaxar verificações de negócio
ou corrigir módulos alheios. Os testes de apresentação migrados verificam agora
os componentes Tailwind que possuem essas regras e a nova navegação solicitada.
Os fluxos reais de serviços externos não foram exercitados contra contas ou
infraestrutura de produção; os testes de navegador usam as fixtures existentes.

## Resultado dos gates — intervenção inicial

Validação final no contentor existente `wharnex-frontend-review:local`, sem rede,
sem capabilities adicionais e com `no-new-privileges`:

| Verificação | Resultado |
| --- | --- |
| TypeScript | Aprovado |
| Build de produção | Aprovada |
| Testes focados nas áreas alteradas | 128 aprovados, 0 falhas |
| Navegador: ferramentas, aparência, rascunhos, runtime e layout | 12 aprovados |
| Navegador: separadores partilhados, claro/escuro | 2 aprovados |
| Suite completa | 1 411 aprovados, 62 falhas |
| Revisão original, mesmo contentor | 1 402 aprovados, 63 falhas |
| Atribuição das falhas | 0 novas; uma falha anterior de geometria do separador deixou de ocorrer |
| Lint | Os mesmos 3 erros anteriores em DrawioPreview.test.tsx e drawioModel.ts |
| Limite de tamanho | Aprovado; ficheiros novos até 200 linhas |
| Estrutura dos domínios novos desta alteração | 0 violações |
| Gate global de domínios | Bloqueado por diretórios backend anteriores: app (291), sandbox (66), uitesting/httpapi (21) |
| `git diff --check` | Aprovado |

As falhas anteriores remanescentes não foram corrigidas nem ocultadas por esta intervenção.
A build mantém o aviso existente sobre chunks superiores a 500 kB. As verificações
Go e a operação de serviços reais não fazem parte desta alteração exclusivamente
frontend na intervenção inicial; não foi feito rollout dos serviços nem alteradas as sessões em execução.


## Foco adicional: documentos abertos, limites visuais e idioma

A lista de documentos abertos usa agora um popover de até 420px de largura e
520px/70vh de altura, limitado também pelo espaço junto ao botão. Pesquisa e
rodapé ficam fixos; só os resultados fazem scroll. Os nomes e os caminhos usam
uma escala menor, com seleção, indicação de alterações e pesquisa por caminho.
Setas/Enter navegam a partir do ficheiro ativo; Escape devolve o foco ao botão.
A pesquisa é limpa ao reabrir e listas sem resultados não provocam ações.

As duas barras de atividades usam uma superfície distinta da dos painéis e do
editor. A ferramenta aberta ganha uma área preenchida com a cor de seleção,
mais o indicador lateral. Os painéis laterais têm limites discretos e cantos
consistentes; os offsets de sobreposição foram ajustados aos 48px das barras.
Os novos valores são tokens derivados do tema, incluindo claro/escuro.

Foi introduzido um catálogo explícito de mensagens e uma preferência local de
idioma: automático/sistema, English, Português e o identificador Français já
existente. A escolha segue os idiomas preferidos do sistema operativo no Desktop,
obtidos por uma extensão read-only opcional de `windows.info()`. Clientes web
e Desktop anteriores seguem os idiomas do browser, com inglês como fallback.
A preferência persiste no dispositivo e sincroniza janelas. A atualização React
mantém a identidade dos componentes e o seu estado. O backend continua a
receber o código de idioma resolvido e os destinos Markdown existentes.

**Limitação real:** a IDE inteira ainda não está traduzida. Foram ligadas ao
catálogo as áreas revistas (navegação da shell, documentos, aparência rápida,
seletor de projetos, navegação de definições/idiomas e controlos operacionais).
Outros painéis e mensagens antigas continuam em Português. O catálogo francês
não foi criado; Français usa o fallback inglês nas áreas localizadas. Nenhuma
substituição automática de texto é aplicada a código, nomes, caminhos ou dados.
A extração dos restantes textos é trabalho pendente para satisfazer o pedido
de uma interface integralmente inglesa.

A migração para Tailwind nesta extensão incide na lista de documentos e nas
superfícies laterais. As alterações apenas de localização preservam o styling
existente das restantes componentes; esta é a exceção explícita de âmbito,
sem novos overrides CSS. A revisão de refatoração separou lista/navegação do
popover e isolou resolução de idioma, subscrição React e catálogos em módulos
com menos de 200 linhas.

A extensão de idioma nativo altera apenas metadados opcionais da resposta de
informação da janela. Usa o mesmo `trustedSender`, não cria canais IPC nem
expõe ambiente, credenciais ou conteúdo do browser. Hosts antigos continuam
compatíveis. O teste do adaptador verifica a prioridade nativa e a precedência
da escolha manual; o helper Desktop valida e limita a lista de idiomas.


### Validação da extensão focada

Todas as verificações foram executadas no contentor de ferramentas existente,
sem rede e sem alterações aos serviços em execução.

| Verificação | Resultado |
| --- | --- |
| TypeScript e build final | Aprovados; mantém-se o aviso de tamanho dos chunks |
| Testes focados finais: documentos, docking, idioma nativo e projetos | 33 aprovados, 0 falhas |
| Shell, repetida isoladamente para investigar uma falha de sincronização | 20 aprovados, 0 falhas |
| Browser: 70 documentos, pesquisa, foco, limites, idiomas, temas, densidades e regressões | 20 cenários distintos aprovados |
| Desktop `npm run check` | 1 197 testes aprovados, 0 falhas, incluindo sintaxe e novos testes de locale |
| Suite frontend completa executada | 1 483 casos; 1 420 aprovados, 63 falhas |
| Atribuição da suite completa | 62 falhas já conhecidas e uma falha intermitente adicional na sincronização de popovers; não se reproduziu ao repetir os 20 testes da shell |
| Adaptador de idiomas nativos, acrescentado depois dessa execução global | 3 testes adicionais aprovados na execução focada final |
| Lint final | Os mesmos 3 erros anteriores de Drawio; 0 avisos novos |
| Ficheiros novos desta intervenção acumulada | 54 fontes/testes; todos até 200 linhas, sem violações de domínio |
| Gate global de domínios | Mantém as 3 violações backend anteriores |
| `git diff --check` | Aprovado |

A falha intermitente foi mantida no resultado global, sem relaxar o teste. As
fixtures antigas passaram a declarar um dispositivo português, incluindo os
cenários que limpam o armazenamento; testes separados cobrem inglês, resolução
do sistema, dados de locale inválidos e persistência. Os contratos visuais foram
atualizados apenas para os estados preenchidos agora pedidos e para o rótulo
localizado do seletor nativo, preservando as verificações funcionais.

Componentes principais desta extensão: `EditorDocumentsMenu`/`DocumentsList`,
`ControlPopover`, `WorkspaceNavigation`, `WorkspaceSideRail`, `panelAllocation`,
`AppearanceChoices`, `ShellChrome`, `WorkspaceSwitcher`, `SettingsFrame`,
`LanguageSettingsPanel` e o domínio `lib/workspace/localization`. No Desktop,
`window/appearance` fornece apenas os metadados de idioma usados pelo handler
existente de informação da janela.


A continuação da tradução, redução de texto auxiliar e revisão da tipografia
está descrita em [content-review-2026-10-16.md](content-review-2026-10-16.md).
