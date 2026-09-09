# Conhecimento do projeto

## Frescura do frontend após self-evolution

Uma alteração frontend pode estar corretamente presente no source e ainda assim o Desktop mostrar a UI anterior. Neste projeto, isso pode acontecer em duas camadas independentes:

1. o rollout de Compose pode manter/reutilizar um container ligado a uma imagem anterior mesmo depois de novas tags terem sido preparadas;
2. Electron/Nginx podem reutilizar um `index.html` antigo do cache persistente e, com isso, continuar referenciando assets do build anterior.

A defesa adotada é deliberadamente redundante:

- `scripts/stack.sh` ativa `backend`/`frontend` com `--force-recreate` e compara os IDs das imagens desejadas com os IDs efetivamente usados pelos containers antes de considerar o rollout bem-sucedido; o rollback também força recriação;
- `services/frontend/nginx.conf` serve `/index.html` com política `no-store/no-cache`;
- `services/desktop/main.mjs` acrescenta um token único por processo (`wharnessRuntime`) à URL local do frontend.

Ao diagnosticar no futuro uma UI que parece ignorar uma alteração já aplicada, verificar primeiro a imagem realmente usada pelo container e a frescura do documento HTML/runtime antes de refazer o JSX/CSS.

## Dependências exclusivas do host e reparação automática

Falhas provocadas por dependências nativas/opcionais ou por estado de toolchain que só existe no host são falhas locais de ambiente, não defeitos do patch nem do modelo. Quando identificadas, devem ser classificadas como `host_dependency_state` e interromper a cadeia automática de repair/retry via ChatGPT, evitando ping-pong sem possibilidade de correção por source patch.

A UI não deve oferecer retry de rede para `host_dependency_state`. Se um retry explícito de dependências falhar numa verificação posterior, a sessão deve ser recarregada antes de libertar a UI para que o estado visual corresponda ao estado persistido.

No self-evolution, stdout/stderr de `make build-stage` podem chegar concorrentemente; o buffer agregado e o callback de streaming precisam ser serializados pelo mesmo mecanismo de sincronização para que `go test -race` permaneça limpo e para evitar corrupção ou data races na emissão do progresso.

## Histórico progressivo do chat

Chats longos devem abrir na janela das 20 mensagens mais recentes, já posicionados no fim antes da pintura inicial. Ao aproximar-se do topo, o frontend carrega mais 20 mensagens anteriores e preserva a posição visual do leitor.

Nova atividade só acompanha automaticamente a cauda enquanto o utilizador permanecer perto do fundo. Se estiver a consultar histórico antigo, novas mensagens não devem provocar saltos para o fim. O carregamento manual de mensagens anteriores permanece disponível como alternativa acessível.

## Transporte do request bundle para ChatGPT

O planner em modo de attachment local deve chegar ao ChatGPT como exatamente um request ZIP físico contendo prompt, contexto, artefactos, referências e anexos internos. Esse ZIP deve ser selecionado no `input#upload-files` dedicado por CDP com `DOM.setFileInputFiles`, preservando o basename canónico do ficheiro.

Clipboard `text/uri-list`/paste não deve ser usado como fallback para esse transporte: Chromium/ChatGPT pode materializar um ficheiro anónimo ou renomeado e retries podem duplicar o estado do anexo. Se o file input dedicado não estiver disponível, o transporte deve falhar fechado em vez de recorrer a paste ambíguo.

## Recuperação de execuções interrompidas

Uma execução cuja chamada desaparece antes de um resultado terminal deve permanecer como intenção durável por sessão/plano e nunca ser retomada automaticamente. Após reload/restart, estados transitórios `running`/`resuming` são normalizados para `awaiting_decision`, exigindo decisão explícita do utilizador.

A UI apresenta essas intenções num Recovery Center persistente e não modal: chats não relacionados, Editor, logs e ChatGPT continuam utilizáveis; o bloqueio fica restrito ao chat cuja retomada está ativa. `Continuar`/`Repetir` deve ser reconhecido rapidamente, marcar `resuming` e reentrar no FIFO autoritativo em background; pedidos duplicados para a mesma intenção ativa são idempotentes. Falha retryable mantém o cartão com erro, sucesso/reconciliação remove a intenção, e `Descartar` só limpa uma intenção que não esteja em execução.

## Reaplicação após conflito concorrente no host

Nesta tarefa, a mudança já validada no sandbox encontrou divergência concorrente no host durante o Apply nos ficheiros de reparo de dependências. O caminho seguro foi abortar a transação, refrescar a baseline, limitar a ronda de conflito aos paths afetados, preservar a implementação concorrente e reaplicar apenas o streaming pretendido.

A revalidação da ronda de conflito voltou a precisar de aprovação explícita de rede para preencher/resolver o cache de módulos Go no sandbox. Portanto, uma aprovação de dependências numa ronda anterior não deve ser presumida como suficiente para uma nova execução de conflito.

## Reparação de testes após remoção intencional de semântica no cabeçalho

Nesta tarefa, a primeira verificação falhou porque `AgentWorkspace.test.tsx` ainda procurava o heading `Principal` no cabeçalho, embora a alteração tivesse removido intencionalmente esse título duplicado e mantido o nome da conversa apenas no seletor de chats. A reparação correta não foi restaurar o heading: foi atualizar o teste para afirmar a sua ausência e localizar `Principal` pela tab do seletor.

Ao simplificar UI ou remover semântica acessível de forma deliberada, testes de integração que usam `getByRole` podem representar o contrato antigo mesmo quando o source novo está correto. Numa repair round, confirmar primeiro se a expectativa falhada ainda pertence ao UX pretendido; quando não pertence, alinhar o teste com a nova superfície preservando a cobertura da capacidade equivalente.

## Validação frontend quando o sandbox não contém dependências instaladas

Nesta tarefa, os gates frontend no sandbox falharam com exit 127 porque `vitest`, `tsc` e `eslint` não estavam instalados no snapshot exportado. Wharness classificou corretamente essas falhas como baseline inalterada, evitando uma repair round contra o patch.

O Apply no self-evolution seguiu adiante e o build do host, dentro da imagem Docker que instala as dependências do frontend, concluiu `npm run build` com sucesso. Quando o sandbox reproduz exatamente a ausência pré-existente de `node_modules`, usar a comparação com a baseline para distinguir falta de toolchain de regressão do source; não transformar esse sinal isolado em correção de código. A validação real deve ocorrer num ambiente que materialize as dependências antes de concluir sobre testes/typecheck/lint.

## Hidratação de dependências Go no sandbox

Nesta tarefa, a primeira execução do plano terminou antes dos gates de Go com `offline sandbox dependencies unavailable: host Go module cache is unavailable`. O patch já tinha sido aplicado no sandbox e `git diff --check` passava; não havia evidência de defeito no source.

A recuperação que funcionou foi autorizar explicitamente a hidratação de dependências para a mesma execução e correr `go mod download` no backend. Depois disso, `go vet` e `go test` dos pacotes afetados passaram sem qualquer alteração adicional ao patch, e o mesmo candidato seguiu para commit, merge e Apply no host.

Quando este sintoma reaparecer, tratar primeiro como ausência de materialização do cache no sandbox: não iniciar repair de código apenas por esse erro. Solicitar/usar a aprovação de rede apropriada para preencher o cache e repetir os mesmos gates antes de concluir que existe regressão no source.
