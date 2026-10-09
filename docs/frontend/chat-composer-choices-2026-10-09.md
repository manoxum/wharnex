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
