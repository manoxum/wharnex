# Chat composer: escolhas compactas e modelos da conta

Contexto e Inteligência apresentam ícone e valor escolhido, conservando os nomes
acessíveis e as preferências existentes da sessão. Esforço continua independente.
O novo controlo Modelo do ChatGPT consulta o menu do chat apenas ao gesto humano;
não contém uma lista de modelos codificada no frontend.

O Desktop devolve o inventário estrutural do chat e confirma a seleção remota.
O frontend só apresenta a nova seleção após essa confirmação. O menu mostra os
estados de consulta e atenção e não oferece opções antigas após uma descoberta
falhada. Trocar de chat invalida respostas assíncronas do chat anterior.
Requests ativas, uploads preparados e transporte manual bloqueiam a escolha.
As setas, Home, End e Escape permitem navegar e fechar o menu com teclado.

A resolução dos modos foi extraída de ChatPanel para ComposerSessionControls;
os controlos novos vivem no subdomínio composer/choices, com ficheiros menores
que 200 linhas. Contexto deixou as cores literais e usa os tokens de tema.
Inteligência removeu a sua regra CSS antiga. O Esforço mantém a superfície
existente, fora da alteração pedida. Os controlos novos usam Tailwind; utilitários
importantes preservam a fronteira com defaults globais de select/button ainda
usados por outras superfícies, sem modificar o CSS global.

Aplicada a skill vercel-react-best-practices: a descoberta é feita no evento,
sem efeito de montagem nem polling, e a identidade do chat separa estado e
resultados pendentes. A integração Desktop e os testes de transporte são
descritos na documentação da manutenção do scraper.

Validação visual local com Chromium, usando inventário sintético apenas na
pré-visualização de UI: Light/Dark e largura de 460 px, sem overflow horizontal;
o popup adapta a direção ao espaço disponível. Esta verificação não é uma
validação do inventário real do ChatGPT. Contexto mede 55 px no select e
Inteligência 85 px, sem os labels redundantes anteriores.

Gates da alteração: typecheck, lint da superfície modificada, build de produção
e 33 testes focados passaram. A suite completa foi executada e continua vermelha:
67 falhas, 1201 testes aprovados e quatro erros assíncronos, registados em
`.harness/maintenance/composer-choices-20261009/tests-final.log`.
As nove regressões do modelo e os quatro testes de integração dos controlos
passaram nessa execução completa.

A comparação com o baseline independente identifica 57 cabeçalhos de falha
iguais. Sete diferenças passaram ao repetir os mesmos testes isoladamente,
sem aumentar timeouts nem alterar assertions; a FIFO excedeu o mesmo timeout
no baseline e na alteração. Duas assertions antigas de App.effortLevel procuram
opções e tooltip diretamente em ChatPanel, apesar de o HEAD já as compor através
de ComposerRequestControls: a ausência dos literais no HEAD confirma que essas
falhas precedem esta alteração. O lint global mantém três erros em
DrawioPreview.test.tsx e drawioModel.ts, ficheiros não alterados por este trabalho.
Não foram modificados testes existentes para tornar esses gates verdes.

A manutenção das mensagens de erro reutiliza agora o helper errorMessage do
domínio de diálogos. Erros de outro realm e objetos IPC conservam a causa
acionável, removendo apenas o prefixo de transporte Electron. A descoberta
continua fechada após erro, sem opções antigas ou seleção fictícia; um erro
de seleção conserva o modelo anteriormente confirmado. Três regressões
falharam antes da correção e passaram depois, sem alterar assertions existentes.

Typecheck, lint dos dois ficheiros, build e 14 testes focados passaram. Ambos
os ficheiros continuam abaixo de 200 linhas. Na suite completa posterior, os
12 testes do controlo passaram; o gate global continua vermelho, com 173
falhas, 1114 aprovados e quatro erros assíncronos. A comparação identifica
58 cabeçalhos iguais ao baseline e 115 diferenças, das quais 107 são timeouts.
Esta comparação não prova que todas as diferenças são anteriores à alteração.
Os logs model-errors-full-tests.log e model-errors-full-attribution.json ficam
em .harness/maintenance/composer-choices-20261009. O lint global, após o dono
remover o cache de preview gerado de dentro do frontend, voltou aos mesmos
três erros Drawio, sem warnings. Nenhum timeout, teste ou config foi relaxado.
A fonte foi preservada e congelada antes da transação de auto-integração.

Um recheck estreito comparou 13 casos contra um checkout isolado exato do
HEAD 0ce0e16e, incluindo o prompt.go necessário às assertions estáticas.
Ambos deram 8 aprovados e as mesmas 5 falhas: duas assertions App.effort e
AgentWorkspace library/FIFO/close explorer, com causas iguais. Rate-limit,
knowledge, viewport e Git diff passaram em ambos, assim como quatro casos
representativos dos timeouts. O relatório model-errors-isolated-attribution.json
preserva nomes, duração e causa. As restantes diferenças de timeout não foram
todas repetidas; o gate completo continua vermelho. Nenhuma assertion ou
duração foi alterada para obter estes resultados.
