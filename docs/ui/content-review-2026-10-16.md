# Wharnex — conteúdo, tipografia e tradução

Esta etapa continua a revisão anterior e mantém as alterações já existentes.

## Alterações

- Catálogos ingleses alargados aos controlos de Orchestrator (visão geral,
  planeamento, tarefas, ações e detalhes), notificações, detalhes dos agentes,
  estados Docker, conhecimento, aparência, TODOs e tradução de Markdown.
- Valores dos registos de interface são traduzidos no render; identificadores,
  estados técnicos, nomes, caminhos, mensagens humanas, evidência e conteúdo
  dos documentos permanecem originais. Datas de interface seguem o idioma.
- Escala tipográfica partilhada aproximada, a 100%: legendas 12px, etiquetas
  13px, leitura 14px, títulos de painel 15px, secções 16–17px e títulos maiores
  até 19px. Os antigos extremos Tailwind de 10px/29px foram aproximados.
  A escala persistida e os tamanhos de Monaco/PTY continuam independentes.
- Detalhes dos agentes usam a escala semântica de leitura, substituindo os
  17px resultantes das declarações locais anteriores.
- Cabeçalhos de ferramentas mais baixos (cerca de 40px, 36px em Compacto),
  estados vazios menores e introduções de configurações acessíveis por tooltip.
- Removidos slogans, descrições repetidas, explicações redundantes dos cartões,
  rodapés genéricos, legendas duplicadas das notificações e dicas permanentes
  dos temas. Os avisos de impacto, erros, consequências de consolidação,
  operações destrutivas e necessidade de reiniciar continuam disponíveis.
- Barra de pesquisa/consolidação do conhecimento reorganizada para aproveitar
  a largura; a ação só aparece quando existe o respetivo callback funcional.
- Toolbar Markdown migrou para os controlos partilhados e tokens de tema,
  incluindo os erros. A tradução continua explícita e não altera o original.

## Componentes e qualidade

Principais superfícies: `presentation/workbench`, `settings/presentation`,
`settings/navigation`, `settings/appearance`, `agent/runtime/presentation`,
`attention/center`, `project/knowledge`, `project/tasks/presentation`,
`orchestrator/{overview,planning,tasks}`, `presentation/content` e
`lib/workspace/localization/catalogs`.

A migração Tailwind incide na tipografia e nos controlos efetivamente revistos.
As declarações legadas correspondentes das notificações foram removidas dos
seus ficheiros de domínio; a toolbar Markdown deixou de depender das regras
anteriores. O stylesheet vazio de conhecimento e a sua importação foram
eliminados. O layout legado que não pertence a esta alteração foi preservado.
Apenas localizar texto nos restantes componentes não implica uma reescrita do
seu layout; esta é a exceção explícita de âmbito à migração de styling.

A revisão final removeu duplicações de tradução, propriedades CSS sem efeito,
helpers de texto sem consumidores e manteve módulos e catálogos abaixo de
200 linhas, em diretórios de domínio. Não foram adicionadas dependências.

## Verificação

Ferramentas executadas no contentor existente, sem rede e sem alterar os
serviços em execução:

| Verificação | Resultado |
| --- | --- |
| TypeScript e build | Aprovados; aviso anterior de chunks grandes mantém-se |
| Browser | 17 cenários aprovados: claro/escuro, Normal/Compacto, medidas reais das fontes, escala, pesquisa, notificações, foco e regressões do workbench |
| Suite frontend completa executada | 1 490 testes: 1 428 aprovados, 62 falhas anteriores; nenhuma falha nova atribuída à alteração |
| Verificação focada final | 37 de 38 aprovados; a falha de arquivamento de TODO já existe na revisão anterior |
| Preferências de idioma, depois da limpeza dos textos | 3 testes aprovados |
| Lint | Os mesmos 3 erros anteriores em DrawioPreview.test.tsx e drawioModel.ts; nenhum novo aviso |
| Estrutura e limite dos ficheiros novos acumulados | 61 fontes/testes, sem violações de domínio ou do limite de 200 linhas |
| `git diff --check` | Aprovado |

As expectativas visuais e de copy dos testes foram atualizadas para os novos
tamanhos e mensagens pedidos, preservando as asserções de carregamento,
navegação e execução das ações. A comparação não relaxou testes de negócio.

## Âmbito restante

A tradução integral da IDE continua pendente: há mensagens e vistas legadas
fora desta passagem. Français mantém o fallback inglês nas áreas localizadas.
Esta revisão não traduz automaticamente mensagens do backend ou conteúdo do
utilizador. Os estilos legados não alcançados pela escala partilhada podem
precisar de novas migrações pontuais. Não foi feito rollout dos serviços.
