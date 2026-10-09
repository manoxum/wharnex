# Processos órfãos e ativação — 2026-10-09

Na continuação do diagnóstico, o backend ainda executava a imagem anterior.
A árvore de processos revelou mais de 6.500 processos `git` zombies adotados
pelo backend, que era PID 1 do container. Esse total chegou a **8.122** antes
da ativação. Zombies não usam CPU ou RSS como processos vivos, mas conservam
entradas na tabela de processos e podem esgotar limites de tarefas.

## Correção e compatibilidade

- `compose.yml` agora declara `init: true` e `stop_grace_period: 30s` no backend.
  O init recolhe descendentes órfãos e encaminha sinais; os `Wait` dos filhos
  diretos continuam a pertencer ao executor. A tolerância de 30 s permite o
  shutdown HTTP de 10 s e a drenagem dos logs/estado.
- O caminho rápido de `scripts/stack.sh` verifica também essas configurações
  do container. Imagens iguais e endpoints saudáveis deixam de ocultar uma
  configuração de criação antiga. Reiniciar o mesmo container não adiciona
  init: é necessária recriação.
- A verificação foi extraída para `scripts/stack/readiness.sh`. As mesmas
  quatro verificações de saúde continuam obrigatórias. Os checks de Compose
  do gate foram extraídos para `scripts/stack/lifecycle-check.sh`, preservando
  todas as asserções e verificando importação e chamada do novo módulo.
- Não se introduziu um reaper global em Go, que poderia consumir o estado de
  saída de comandos aguardados por outros executores. A política de execução,
  o sandbox, os volumes e os identificadores persistidos não mudaram.
- O coletor manual agora distingue o estado `Z` do consumo de processos vivos.

O comportamento do init segue a
[documentação oficial do Docker](https://docs.docker.com/engine/containers/multi-service_container/).
A configuração é definida na
[referência oficial do Compose](https://docs.docker.com/reference/compose-file/services/#init).

## Reprodução e ativação

O teste `scripts/performance/container_init.test.mjs` compila uma fixture Go
que cria 16 descendentes órfãos num container isolado: **16 zombies sem init,
zero com init**, usando a mesma imagem. Não monta projetos, credenciais nem
socket Docker; usa rede desativada, filesystem read-only, capacidades removidas
e limites de memória/processos. Executar explicitamente com:

```bash
WHARNEX_DOCKER_PROCESS_TEST=1 node --test scripts/performance/container_init.test.mjs
node --test scripts/stack/readiness.test.mjs
```

Antes do rollout, verificou-se que não havia sessões em execução/Apply/build
nem descendentes vivos do backend. Foi preservada a imagem anterior como
`wharnex-backend-rollback:performance-20261009`. O build canónico e
`scripts/stack.sh activate-services backend` terminaram com sucesso.
PostgreSQL, túnel e MinIO mantiveram os mesmos IDs de container e imagem;
o Desktop permaneceu aberto durante a ativação. A aplicação voltou a saudável,
sem reinícios adicionais, com init e tolerância de 30 s confirmados por inspect.

## Resultado observado

| Medida | Antes | Após a ativação |
| --- | ---: | ---: |
| Zombies na árvore do backend | 8.122 | 0 |
| CPU do backend no perfil de 10 s | 4,06 s / 40,59% de um núcleo | 1,88 s / 18,80% |
| Processos residentes na árvore, sem comando em curso | mais de 8.000 | 2 |

A confirmação posterior continuou a encontrar dois processos adormecidos,
zero zombies e o backend saudável. O perfil novo identifica
`gitops.IndexGitlinks`, confirmando que a leitura incremental do índice da
primeira etapa está ativa. As janelas de CPU tinham cargas diferentes: são
resultados observados, não um benchmark controlado nem uma garantia de ganho
global de 54%.

Na amostragem de 15 s após o rollout, o backend usou em média 14,9% de um núcleo
e atingiu cerca de 1.003 MiB de RSS. **Não foi demonstrada redução de RAM**.
O sistema ainda tinha cerca de 6.608 MiB de swap ocupada. CPU agregada por nome:
Chrome ~91,8%, Electron ~67%, VS Code ~60,7% e PostgreSQL ~319,6%. A inspeção dos
processos atribuiu o PostgreSQL com maior CPU ao container `flowcore-postgres-1`,
de outro projeto. Esses totais não pertencem todos ao Wharnex; RSS somado também
pode contar páginas partilhadas mais de uma vez. Não se interrompeu trabalho
de outros projetos.

## Verificação e limites

Build, `go vet`, regressão Docker, testes de readiness, sintaxe shell, testes
Python e gate completo de lifecycle passaram. As suítes Go normal e race
voltaram a mostrar somente as três falhas preexistentes de PTY documentadas
na [primeira etapa](runtime-optimization-2026-10-09.md), sem novas falhas ou
data races. Os gates estruturais continuam a identificar o ficheiro anterior
de 223 linhas e os domínios anteriores com 291/21 ficheiros; não foram relaxados.
Não houve mudanças de frontend ou Desktop nesta segunda etapa.

A revisão de refatoração foi limitada ao reaping/configuração de criação,
readiness, checks de lifecycle e estado do coletor. Os novos módulos possuem
menos de 200 linhas e pertencem a domínios nomeados. Os entry points antigos
ainda excedem esse limite; os concerns tocados foram extraídos, sem reescrever
partes alheias à mudança. Perfis privados temporários foram removidos.

A pressão restante exige medir a retenção dos snapshots e a latência da UI em
cenários comparáveis. Cache sem invalidação ou mais paralelismo nesta máquina
poderiam ocultar alterações e aumentar a competição por recursos. O espelho já
partilha a codificação e cacheia o quadro inicial; o estado Git permanece fresco.
