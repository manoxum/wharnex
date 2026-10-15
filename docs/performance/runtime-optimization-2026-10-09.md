# Diagnóstico e otimização do Wharnex — 2026-10-09

Foram recolhidos recursos do sistema e perfis Go enquanto o Wharnex existente
continuava a executar. A primeira etapa implementou e verificou as otimizações
sem substituir processos ativos. Na continuação, o backend foi compilado pelo
build canónico e ativado às 09:56 UTC, depois de cessar a execução e o build
em curso. O diagnóstico, a correção adicional e as medições após a ativação
estão em [Processos órfãos e ativação](process-reaping-2026-10-09.md).

## Evidência em execução

- Máquina com cerca de 15,3 GiB de RAM e 12 CPUs disponíveis. A primeira
  observação mostrava carga média de 19,71/25,41/25,25 e 4.009 MiB em swap.
  A pressão de CPU indicava espera relevante por tempo de processamento.
- Backend: 32% de um núcleo numa amostra de 5 s; um perfil de 10 s mediu
  2,92 s de CPU. O RSS variou durante a coleta; uma amostra mostrou 709 MiB.
- O perfil heap estimava 360,88 MiB vivos e 192,06 GiB de alocações acumuladas
  desde o arranque. Alocação acumulada **não** é RAM ocupada simultaneamente.
- `hostrepo.Inspect`/`inspectSubmodules` apareciam nos principais caminhos de
  alocação. `gitops.execute.func1` representava cerca de 69 GiB acumulados:
  o índice inteiro era capturado, convertido para string e dividido para
  selecionar apenas entradas Git de modo `160000`.
- Amostragem adicional de 15 s, com verificações e outros projetos ativos:
  PostgreSQL agregado ~180% de CPU, VS Code ~105%, processos Vitest ~129%,
  Electron ~53%, backend ~49%. Esses valores agregam processos com o mesmo
  nome; PostgreSQL e Electron podem incluir serviços de outros projetos.
  O RSS somado do Electron chegou a ~2.734 MiB, com páginas partilhadas
  potencialmente contadas mais de uma vez. Essa janela não representa idle.
- A fila tinha aproximadamente 760 tarefas: havia limpezas, renomeações,
  arquivamentos e centenas de `UI_TEST_RUN`. Foram observadas tarefas ativas.
  Não se apagou trabalho durável para reduzir contadores.

## Alterações implementadas

1. **Leitura do índice Git em fluxo.** `gitops.IndexGitlinks` drena stdout
   incrementalmente e retém apenas gitlinks. Preserva separação de stderr,
   cancelamento e a recuperação existente de lock. Diagnósticos são drenados
   com retenção limitada a 64 KiB; registros acima de 1 MiB ou truncados falham
   explicitamente. A inspeção de submódulos foi extraída para o seu subdomínio.
   O índice é relido a cada inspeção: não há cache que oculte alterações.
2. **Codificação do espelho sob demanda.** Sem um assinante visível,
   autorizado e pronto para receber, não se codifica JPEG. Mantém-se apenas
   a imagem mais recente. A confirmação de receção entrega esse quadro,
   respeitando os limites existentes de 125/66 ms e a entrega imediata quando
   o intervalo já decorreu. Assinantes partilham uma única codificação.
3. **Cache do quadro inicial.** Uma nova assinatura reutiliza o quadro já
   codificado. Navegação e suspensão invalidam o cache. Capturas assíncronas
   antigas são descartadas por revisão; sequências permanecem crescentes
   após invalidar o cache. A suspensão liberta as imagens retidas.
4. **Coletor de recursos.** `scripts/performance/runtime_sample.py` observa
   processos durante 1–60 s, com CPU por intervalo, RSS e threads. Não lê argv,
   ambientes, credenciais, ficheiros dos projetos ou conteúdo de páginas.

## Comparação controlada

Uma fixture de índice real contém 40.000 ficheiros comuns e um gitlink
não registado. A mesma fixture e o mesmo benchmark foram executados antes e
depois, incluindo uma cópia que conserva as outras alterações do workspace
e remove apenas as otimizações desta mudança.

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Alocação por inspeção, benchmark inicial | 15.146.816 B | 360.666 B |
| Alocação por inspeção, repetição de 5 iterações | 15.147.182 B | 360.115 B |
| JPEGs para seed + 100 paints sem confirmação | 101 | 1 |
| Capturas iniciais para duas assinaturas sequenciais | 2 | 1 |

A redução de alocações na inspeção é de aproximadamente **97,6%**.
Os tempos de parede variaram com a carga concorrente; não se inferiu deles
uma aceleração global da interface. Os perfis após a ativação mostram menos
CPU no backend; a latência da interface ainda exige comparação com o mesmo
cenário e a mesma carga.

## Validação e compatibilidade

- A regressão de memória falhou antes com 15.149.104 B e passou depois com
  361.104 B, sem alterar a sua asserção de 2 MiB.
- Regressões do espelho falharam antes por codificações e capturas redundantes;
  depois passaram, juntamente com todos os testes existentes desse domínio.
- Casos adicionais verificam múltiplos assinantes, revogação, janela oculta,
  navegação, suspensão/retoma e captura assíncrona obsoleta.
- `go vet -p 2 ./...`, compilação do backend e testes focados passaram.
  Os módulos Git alterados também passaram com `go test -race -p 2`.
- Suíte Desktop final: **1.084 testes passaram**, zero falhas, com
  `node --test --test-concurrency=2`; verificações de sintaxe passaram.
- Testes do coletor: dois casos passaram. `git diff --check` passou.
- `go test -p 2 ./...` e `go test -race -p 2 ./...` terminaram com
  as mesmas três falhas preexistentes de PTY, sem novas falhas:
  `TestHostPTYBridgeKeepsShellAliveAcrossClientDetach`,
  `TestHostInteractiveTerminalProvidesARealPersistentPTY` e
  `TestHostInteractiveTerminalDelegatesToLoggedInUserBridgeWhenConfigured`.
  As mesmas três falhas foram reproduzidas na cópia sem estas otimizações.
- Os gates globais de estrutura continuam bloqueados por dívida anterior:
  `settlement.test.mjs` tem 223 linhas também em HEAD; `internal/app` tem 291
  ficheiros e `internal/uitesting/httpapi` tem 21. As mesmas violações de
  domínio aparecem retirando apenas os ficheiros desta mudança. Os novos
  ficheiros passam as regras existentes e os ficheiros mantidos ficaram
  abaixo de 200 linhas. Os entry points legados dos scripts da segunda etapa
  conservam dívida não relacionada; o concern tocado foi extraído para
  `scripts/stack/`. Nenhum gate foi relaxado.
- Não foram modificados protocolos de execução, limites de sandbox,
  quantidade de Supervisors, persistência ou estilos. Os canais IPC antigos
  `wharness:*` permanecem apenas como fronteiras de compatibilidade.

## Repetir a coleta

```bash
python3 scripts/performance/runtime_sample.py --seconds 30 --interval 2
```

CPU é expressa por núcleo: 100% corresponde a um núcleo. Processos que começam
e terminam entre duas amostras podem não ser observados. O coletor é uma
ferramenta manual limitada, não um daemon de produção.

Para perfilar Go, use o pprof já existente em `127.0.0.1:6060` através de
`docker exec`, sem publicar a porta, e analise os ficheiros com `go tool pprof`.
Perfis são artefactos privados e temporários; não devem ser enviados ao planner
ou incluídos em contexto. O benchmark reproduzível é:

```bash
cd services/backend
go test ./internal/hostrepo/submodules -run '^$' \
  -bench BenchmarkLargeIndexTopology -benchtime=5x
```

O rollout canónico do backend foi concluído na segunda etapa. O Desktop
permaneceu aberto durante essa troca; posteriormente foi observado outro
PID principal do Electron. Não se atribui essa troca ao rollout do backend.

O Editor e painéis laterais já usam lazy loading; não foram carregados
antecipadamente. Mais paralelismo indiscriminado compete por CPU e memória
nesta máquina. Próximas medições devem separar idle, geração, espelho visível,
build/testes e UI Lab; comparar alocação Go por intervalo e latência da UI;
examinar o custo de resolução de caminhos e o tamanho dos snapshots de sessão
antes de introduzir caches adicionais. Não se deve cachear permissões,
contenção de caminhos, estado Git ou contexto sem invalidação demonstrada.

As APIs de captura e confirmação seguem as capacidades documentadas de
[webContents no Electron](https://www.electronjs.org/docs/latest/api/web-contents/).
A leitura em fluxo usa os limites explícitos do
[Scanner da biblioteca padrão Go](https://pkg.go.dev/bufio#Scanner.Buffer).
