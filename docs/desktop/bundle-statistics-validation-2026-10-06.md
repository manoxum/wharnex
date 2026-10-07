# Validação das estatísticas de bundles — 2026-10-06

Implementação de [ADR-0095](../../adr/ADR-0095-bundle-transport-statistics.md).
O contador existente no **canto inferior direito do workspace** abre uma
janela interna com enviados, recebidos e total por tipo de tarefa. Mantém a
janela móvel de três horas, todos os projetos e todos os pools.

## Evidência real

Uma execução isolada da nova projeção, apenas com consultas `SELECT` sobre o
PostgreSQL existente, reproduziu os **205 uploads** do
[levantamento das 09:00](upload-statistics-2026-10-06.md).
Não houve navegação, envio, alteração da conta ou modificação da fila.

Na mesma janela em que o endpoint anterior devolvia zero enviados:

| 11:57:23–14:57:23 UTC | Enviados confirmados | Recebidos estimados | Total |
| --- | ---: | ---: | ---: |
| Pedido Agent sem tarefa identificável | 0 | 2 | 2 |
| `UI_TEST_DISCOVER` | 1 | 1 | 2 |
| `UI_TEST_RUN` | 134 | 134 | 268 |
| **Total** | **135** | **137** | **272** |

Os recebidos antigos são inferidos de entregas locais e podem incluir uma
nova entrega do mesmo resultado. O UI identifica-os com `*`. Novos downloads
concluídos passam a ter evidência própria, antes da validação semântica.
Um minuto de contexto anterior à janela evita voltar a contar uma entrega
cujo download acabou de sair da janela; esse contexto não aumenta os totais.

## Verificações aprovadas

- `go vet ./...`; vet dos pacotes alterados após a revisão final.
- Testes com `-race` de `bundleusage` e da rota de quota, incluindo PostgreSQL
  real num schema temporário: mais de 1.000 registos, reinício, todas as
  partes e reenvios confirmados, exclusão de tentativas falhadas, janela,
  correlação de entregas e atribuição pelo pedido/tarefa, incluindo a identidade
  de tarefa usada nos bundles de execução do Orchestrator.
- Testes existentes `BundleQuota|BundleWindow` da aplicação.
- `npm run typecheck` e `npm run build` do frontend.
- Três testes do contador e lint de todos os ficheiros frontend desta alteração.
- Dois testes Playwright, em claro e escuro: posição inferior direita,
  ativação por teclado, tabela, workspace interativo, minimizar/restaurar,
  Escape, devolução de foco e viewport estreito.
- `npm run check` do Desktop: **1.028 testes aprovados**. Inclui segurança,
  transporte, downloads e gravação de metadados que não interrompe o trabalho.

Os screenshots sintéticos de validação ficam em
`.harness/logs/bundle-statistics-light.png` e `bundle-statistics-dark.png`.
Os números dessas fixtures são dados de teste, não o levantamento acima.
Chromium correu no container de ferramentas definido em
`docker/tools/browser/Dockerfile`, separado do runner Protected.

## Gates gerais ainda reprovados

O checkout já continha outras alterações em centenas de ficheiros. Foi criada
uma cópia temporária, preservando essas alterações e retirando a implementação
do contador e da consulta backend, para atribuir as falhas sem alterar testes.

- **Lint frontend:** os mesmos três erros na cópia anterior e no checkout:
  variáveis não utilizadas em `DrawioPreview.test.tsx` e caracteres de controlo
  numa expressão regular de `drawioModel.ts`.
- **Testes frontend:** a execução completa falhou sob carga, incluindo timeouts.
  Os mesmos 84 ficheiros foram comparados com dois Workers: 40 ficheiros falham
  em cada estado, 39 em comum, com 66 testes reprovados antes e 61 depois. Dois casos
  variaram entre execuções e passaram nos dois estados quando executados
  isoladamente; não foram relaxadas as suas verificações. Existem também
  quatro erros de mocks de `WorkerFollowViewer` em ambos os estados.
- **`go test ./...` e `go test -race ./...`:** falhas em startup/repositório,
  canal remoto, inspeção de unidades e readiness da ponte Host PTY. Seis
  falhas foram reproduzidas na cópia sem a alteração. Duas falhas adicionais
  de cleanup/reconciliação e o timeout global variaram sob carga.
- **Tamanho:** `agent/scheduling/queue/scheduler/settlement.test.mjs` já tinha
  223 linhas. Todos os ficheiros novos desta alteração têm menos de 200;
  a verificação dos 16 ficheiros de código/testes desta funcionalidade passou.
- **Estrutura:** o gate global aponta os diretórios já sobrelotados
  `internal/app` e `internal/uitesting/httpapi`; não foram acrescentados
  ficheiros a esses diretórios por esta alteração.

Logs completos e comparação: `.harness/logs/bundle-statistics-*.log`.
Não foram alteradas verificações para tornar estes gates verdes.

## Revisão final e compatibilidade

A consulta, classificação de evidência, observação de transporte, atualização
do contador e janela interna têm módulos próprios e testes no respetivo domínio.
Foram removidas as regras CSS antigas do contador e o seu polling duplicado;
a superfície alterada usa Tailwind e a janela partilhada `InternalWindow`.
Os tipos de tarefa reutilizam o catálogo existente. A lista de rotas de
inferência é privada e fechada. A observação de downloads é opcional, limitada
e incapaz de interromper a entrega.

O símbolo interno de normalização de downloads foi migrado para
`canonicalWharnexBundleDownload`, com todos os consumidores e testes atualizados.
Mantêm-se os nomes de bundles, identificadores persistidos e variáveis de
ambiente já publicados. A resposta JSON conserva os campos antigos e acrescenta
`by_task_type`, `source` e `estimated_received`; não há tabela ou migração nova.

**Estado operacional:** código e build validados no escopo acima; aplicação
em uso não reiniciada nem atualizada por esta intervenção. Os gates gerais
reprovados continuam a impedir afirmar uma validação completa do checkout.
