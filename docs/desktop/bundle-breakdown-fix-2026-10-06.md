# Correção da discriminação e contagem de bundles — 2026-10-06

O painel novo recebia a resposta de um backend compilado às 11:41, anterior
à implementação de [ADR-0095](../../adr/ADR-0095-bundle-transport-statistics.md).
Essa resposta continha apenas os totais por artefactos Agent; omitia
`by_task_type` e não contabilizava o transporte dos testes de UI.

A consulta real ao gateway reproduziu a falha: `sent=1`, `received=1`,
`total=2`, sem `source` ou `by_task_type`. Uma asserção de reconciliação
entre as linhas e o total falhou antes da atualização.

Foi compilada e ativada a implementação existente do backend, que consulta
o registo persistido de transporte e resolve as tarefas. O frontend passou
a distinguir uma janela vazia de um serviço antigo que não fornece a
discriminação; conserva os totais e apresenta uma indicação de atualização,
sem inventar categorias. Os contratos JSON opcionais mantêm compatibilidade.

## Verificação em execução

Às 22:35:25 UTC, a resposta real da API reconciliava assim:

| Tipo | Enviados | Recebidos | Total |
| --- | ---: | ---: | ---: |
| `AGENT_REQUEST` | 1 | 1 | 2 |
| `UI_TEST_DISCOVER` | 1 | 1 | 2 |
| `UI_TEST_RUN` | 2 | 1 | 3 |
| **Total** | **4** | **3** | **7** |

O navegador renderizou esse mesmo payload na fixture do painel; as duas
linhas de UI estavam visíveis com os respetivos valores. Estes números são
uma fotografia da janela móvel de três horas, não contagens permanentes.

Backend e frontend foram compilados nas imagens Compose. A atualização
preservou as instâncias de PostgreSQL, MinIO, tunnel e Desktop. As imagens
anteriores ficaram retidas para recuperação. O início do backend excedeu
a espera inicial de ativação; depois foi confirmado saudável e a API passou
na mesma verificação de reconciliação, sem alterar o limite do gate.

## Testes e revisão

- Quatro testes do contador, incluindo a resposta antiga sem detalhe e a
  recuperação após atualizar. O novo teste falhou antes da correção.
- Três testes Playwright: claro, escuro e compatibilidade/recuperação.
- `go test -race` de `bundleusage` e da rota de quota; testes existentes
  `BundleQuota|BundleWindow` da aplicação; vet dos dois pacotes da projeção.
- Integração de `bundleusage` com PostgreSQL real num schema temporário,
  executada dentro do backend, incluindo mais de mil registos de UI e reinício.
- Typecheck e build frontend; lint dos três ficheiros alterados.
- O lint geral continua a falhar nos mesmos três erros de Drawio anteriores
  à correção.
- A suite integral no container terminou com 244 ficheiros/1.167 testes
  aprovados, 41 ficheiros/63 testes reprovados e quatro erros de mocks de
  `WorkerFollowViewer`. Os quatro testes do contador passaram nessa suite;
  as falhas estão em superfícies não alteradas por esta correção. As duas
  execuções host foram interrompidas por SIGTERM; a comparação inicial
  apenas parcial não permite atribuir todas as falhas globais ao baseline.
  Não foram relaxadas verificações, e não se afirma validação global verde.

A revisão de refactoring ficou limitada ao estado vazio do painel e aos seus
testes: mensagem derivada do snapshot, sem estado/polling novo, estilos
Tailwind existentes, domínio próprio e todos os ficheiros abaixo de 200 linhas.
Não houve alteração de schema, protocolo executável ou permissões.
