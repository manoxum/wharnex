# Uploads de bundles — 6 de outubro de 2026

Levantamento local, em modo de leitura, de **09:00:00 até 14:57:23 UTC**
(Africa/Sao_Tome). O levantamento não alterou a fila, conta ou estado da aplicação.

## Resultado

O registo operacional persistido contém **205 uploads confirmados** nesse
intervalo. Todos têm `observed=true` e `file=1/1`. Existem também **205 eventos
de submissão `accepted`**, mas sucesso do transporte não prova sucesso do teste,
da resposta, da execução ou da integração posterior.

| Origem | Uploads confirmados |
| --- | ---: |
| `UI_TEST_RUN` — passos, pré-requisitos e guias | 197 |
| `UI_TEST_DISCOVER` | 1 |
| `BOT_WRITE` | 4 |
| Preparação de pedidos Agent (`prepare:req_…`) | 3 |
| **Total** | **205** |

As 197 confirmações de `UI_TEST_RUN` pertencem a 23 tarefas distintas. Uma
tarefa pode enviar vários bundles e repetir trabalho entre tentativas. Os
testes de UI, incluindo descoberta, representam **96,6%** das confirmações.
Os sete uploads restantes são pedidos Agent; não foram identificados uploads
confirmados de outros tipos de Worker no intervalo consultado.

| Hora UTC | Uploads confirmados |
| --- | ---: |
| 09:00–09:59 | 66 |
| 10:00–10:59 | 1 |
| 11:00–11:59 | 3 |
| 12:00–12:59 | 46 |
| 13:00–13:59 | 63 |
| 14:00–14:57:23 | 26 |
| **Total** | **205** |

Foram encontrados 64 eventos `chatgpt-upload retry`, excluídos do total de
sucessos. Não foi encontrada duplicação exata de confirmações por timestamp,
mensagem e trace. Isto não elimina reenvios reais: um segundo upload confirmado
consome transporte novamente e deve ser contado novamente.

## Limite observado

- Último upload confirmado: **14:26:50.699 UTC**.
- Primeira abertura registada do gate de upload: **14:27:54.987 UTC**, com
  `structural-upload-disabled` e os três inputs de upload desativados.
- Sonda às **14:38:11 UTC**; nova falha às **14:38:31.006 UTC**.
- O gate passou ao nível 2, com próxima janela indicada para **14:58:31.007 UTC**.
  Esse horário é a próxima oportunidade de sonda local, não garantia de
  reposição da quota do provedor.
- Nas três horas anteriores à primeira abertura do gate, houve **137 uploads
  confirmados**.

As confirmações são evidência do transporte observado pelo Wharnex, não uma
consulta à quota oficial da conta. Uploads feitos fora desta instância e
eventuais tentativas que o provedor contabilize apesar de falharem não estão
incluídos.

## Falha de contabilização confirmada

Às **14:57:23.583775086 UTC**, `GET /api/bundle-quota` respondeu:

```json
{"window_hours":3,"limit":80,"sent":0,"received":1,"total":1,"warning":false,
 "window_start":"2026-10-06T11:57:23.583775086Z",
 "window_end":"2026-10-06T14:57:23.583775086Z"}
```

Na **mesma janela**, o registo operacional contém **135 uploads confirmados**:
134 de `UI_TEST_RUN` e um de `UI_TEST_DISCOVER`.

O cálculo em `services/backend/internal/app/bundle_quota.go:46` percorre apenas
`Session.Artifacts` e aceita apenas nomes reconhecidos pelo parser de bundles
canónicos de chat. Conta a data de criação do artefacto, sem exigir confirmação
do upload. Os bundles `whx_ui_test_step_req_…`, `whx_ui_test_guide_req_…` e
`whx_ui_test_discovery_req_…` seguem transporte próprio e ficam fora desse
cálculo. Portanto, o contador observado não representava todos os uploads da conta;
a presença dos uploads no log operacional também mostra que os eventos de
transporte existem, apesar de não entrarem no contador de bundles.

Cada troca UI envia um ZIP, incluindo os dados e capturas de ecrã dentro dele,
através de `services/desktop/agent/automation/ui-testing/chatgpt.mjs:26`.
Uma tarefa não equivale a um upload: passos, dependências, guia e retries de
respostas rejeitadas podem produzir várias trocas.

Há ainda **30 respostas HTTP 400** na validação de guias UI, contra **7 HTTP
200**, durante o intervalo. São contagens de chamadas de validação, não de
uploads nem de testes distintos. Um exemplo recente reporta um campo `type`
desconhecido no JSON. Esse fluxo pode pedir o guia novamente uma vez, gerando
outro upload. A estatística não atribui todas as rejeições à mesma causa.

A correção deve contabilizar confirmações de transporte de todos os pools e
famílias de bundle, preservando reenvios reais e excluindo preparação sem
upload, downloads e observações que nada enviaram. Alterar só o filtro de nomes
não resolve a diferença entre artefacto preparado e ficheiro efetivamente
carregado. A implementação posterior está descrita em
[ADR-0095](../../adr/ADR-0095-bundle-transport-statistics.md), com validação em
[bundle-statistics-validation-2026-10-06.md](bundle-statistics-validation-2026-10-06.md).

## Reprodução do levantamento

Executar no PostgreSQL local, numa transação de leitura:

```sql
BEGIN READ ONLY;
SELECT to_char(date_trunc('hour', occurred_at AT TIME ZONE 'UTC'), 'HH24:MI') AS periodo,
       count(*) AS uploads
FROM harness_operational_log
WHERE occurred_at >= '2026-10-06 09:00:00+00'
  AND occurred_at < '2026-10-06 14:57:23.583775086+00'
  AND component = 'chatgpt-upload' AND message LIKE 'confirmed %'
GROUP BY 1 ORDER BY 1;

SELECT coalesce(t.type, 'Agent preparation') AS origem, count(*) AS uploads
FROM harness_operational_log l
LEFT JOIN harness_chat_agent_tasks t ON t.task_id = split_part(l.trace_id, ':', 2)
WHERE l.occurred_at >= '2026-10-06 09:00:00+00'
  AND l.occurred_at < '2026-10-06 14:57:23.583775086+00'
  AND l.component = 'chatgpt-upload' AND l.message LIKE 'confirmed %'
GROUP BY 1 ORDER BY 2 DESC;
COMMIT;
```

Fonte: `harness_operational_log`, correlacionado com a vista
`harness_chat_agent_tasks`; `harness_events` e o endpoint de quota foram usados
como contrapontos. O ficheiro `desktop.log` é recriado em cada arranque e não
foi usado como única fonte. Os registos operacionais expiram automaticamente;
as consultas deixam de reproduzir estes totais depois da sua retenção.
