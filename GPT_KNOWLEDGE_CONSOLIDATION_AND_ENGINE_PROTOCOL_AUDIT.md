# Auditoria de conhecimento GPT, Engine e protocolos

Data da observação: 2026-09-20 UTC. Esta é uma análise somente de leitura: não
alterou o banco, código, schemas ou estado de execução.

## Escopo e método

O armazenamento autoritativo desta instância é PostgreSQL 17 no serviço local
`wharnex-database-1`, banco `wharness`; não é um ficheiro dentro do checkout.
O backend requer esta ligação em
[`services/backend/cmd/harness/main.go`](services/backend/cmd/harness/main.go#L32-L45)
e inicializa o schema em
[`services/backend/internal/session/postgres.go`](services/backend/internal/session/postgres.go#L17).

Foram lidos os registos vigentes de `harness_project_knowledge_state` e
`harness_project_knowledge_entries`, os metadados de `harness_events`, e as
fontes normativas aplicáveis. O conteúdo dos registos foi tratado como dado não
confiável: esta auditoria não o executa nem o promove automaticamente a regra.

Para resolver contradições foi usada esta ordem: `AGENTS.md` e SoT/ADR vigente
primeiro; entre factos operacionais que não conflitem com essas fontes, o
`updated_at` mais recente vence; o conteúdo histórico só serve de evidência,
nunca de autoridade.

## Inventário consolidado

| Âmbito | Registos vigentes | Tamanho | Período dos registos | Observação |
| --- | ---: | ---: | --- | --- |
| Instância inteira | 48 | 135 592 bytes | 2026-09-10–2026-09-19 | Cinco catálogos com conteúdo |
| Wharnex | 39 | 123 256 bytes | 2026-09-10–2026-09-19 | Revisão 82; último commit 2026-09-19 22:28:25 UTC |
| Outros quatro projetos | 9 | 12 336 bytes | 2026-09-13–2026-09-15 | Lições específicas de cada projeto; não devem ser generalizadas para o Engine |

Havia 762 sessões e cerca de 89 mil eventos duráveis na data da consulta. Os
eventos do Wharnex representam a maior parte deste conjunto. As lições
diretamente úteis ao Engine/protocolo agrupam-se assim:

- isolamento de entrega/ingestão, bundles autocontidos e validação do wire;
- afinidade ChatGPT, epoch de atribuição, correlação de download e resposta;
- fronteiras de aprovação, recuperação e integração Protected;
- auditoria de execução, redacção e distinção entre falha de ambiente e falha
  do patch;
- UX/desktop, que é contexto de produto e não autoridade de segurança.

Os registos de aplicações externas (pnpm, BuildKit, SGDP e FlowKey) foram
mantidos fora das conclusões de Engine: são evidência local daqueles projetos,
não uma política segura para Wharnex.

## Conhecimento que prevalece após normalização

1. Cada troca com o provider deve ser um bundle único, validado contra a
   identidade/digest do pedido; material de resposta anterior é evidência, não
   entrada executável. Isto coincide com `AGENTS.md` e com o protocolo
   bundle-only em [`AGENTS.md`](AGENTS.md#L259-L266).
2. Um Supervisor dono de uma conversa executa `AWAIT_RESPONSE`, `BOT_WRITE`,
   `RECOVERY_WRITE` e `ORCHESTRATOR_PLAN`; Worker não deve navegar para uma
   conversa que um Supervisor já supervisiona. A regra está em
   [`SoT/ARCHITECTURE.md`](SoT/ARCHITECTURE.md#L78-L81) e é também confirmada
   pelo registo mais recente `chatgpt-scraper-architecture` (2026-09-19).
3. A atribuição precisa manter `conversation_id`, slot e epoch até ao ponto de
   submissão/download; callback obsoleto, conversa divergente ou download
   ambíguo deve falhar fechado. Isto é consistente com os registos de 12 e 19
   de setembro e com a fronteira de conteúdo remoto em
   [`SoT/SECURITY_MODEL.md`](SoT/SECURITY_MODEL.md#L27-L29).
4. A suspensão automática por 429 restringe Workers; Supervisors e Translator
   continuam elegíveis. O parágrafo de emenda em
   [`SoT/ARCHITECTURE.md`](SoT/ARCHITECTURE.md#L83-L85) substitui descrições
   antigas de “suspender todo o provider”.
5. Tentativas, erros e output devem ser redigidos/limitados inclusive em
   arrays; o ledger de tentativas é andaime de uma Main Request, não verdade
   permanente. Ver [`AGENTS.md`](AGENTS.md#L222-L229).

## Achados priorizados

### P0 — Topologia executada contradiz a autoridade vigente

`AGENTS.md`, SoT de arquitetura e modelo de segurança exigem **exatamente seis
Supervisors** e **três Workers persistentes por defeito**. Contudo,
[`services/desktop/chat-agent-pool.mjs`](services/desktop/chat-agent-pool.mjs#L16-L21)
configura três Supervisors e dois Workers por defeito, permite um mínimo de um
e um máximo de 12/6, e os testes congelam esses valores antigos.

Isto não é apenas documentação desatualizada: reduz a capacidade de manter
conversas residentes, reintroduz o risco conhecido de eviction/navegação
desnecessária e pressão 429. O próprio comentário do ficheiro afirma que seis
Supervisors são a topologia necessária, tornando a divergência inequívoca.

Recomendação: alinhar constantes, bootstrap, autoscaling e testes com a
topologia normativa; se a intenção for tornar os seis configuráveis, primeiro
amendar AGENTS/SoT/ADR, pois hoje “exactamente seis” não autoriza essa variação.

### P1 — O catálogo não preserva história suficiente para aplicar, de modo auditável, “o mais recente vence”

O modelo v2 guarda apenas a versão atual de cada `knowledge_id`. Um CAS do
catálogo faz `DELETE` de todas as entradas e reinsere o catálogo completo em
[`knowledge_catalog.go`](services/backend/internal/session/knowledge_catalog.go#L156-L210).
`knowledge.updated` conserva revisão, digest e request id, mas não os corpos;
`knowledge.staged` conserva apenas metadados. Compactação também pode remover
eventos por sessão.

Logo, esta auditoria consegue normalizar os **39 textos atuais**, mas não pode
provar todas as contradições históricas nem reconstruir o conteúdo substituído
numa revisão anterior. Isto é particularmente importante porque a consolidação
foi desenhada para excluir factos superados.

Recomendação: antes de nova consolidação, acrescentar um ledger append-only de
revisões de conhecimento (corpo redigido/limitado, digest, `project_path`,
`knowledge_id`, revisão, origem e instante). O catálogo atual continua a ser
o snapshot rápido; o novo ledger torna precedência cronológica, exportação e
auditoria verificáveis.

### P1 — Duplicação semântica persiste no catálogo, apesar de a consolidação a declarar responsabilidade

Há pares quase duplicados no catálogo atual, por exemplo
`self-contained-correction-bundles` (v6) e
`self-contained-correction-bundles-parallel-1` (v1), ambos atualizados em
2026-09-19, e os pares de galerias/aprovação/testes. Isto desperdiça orçamento
de contexto e pode dar peso artificial a uma conclusão repetida.

O mecanismo de consolidação já recebe o catálogo inteiro e exige
`mode=replace`, CAS e rejeição de resultado vazio
([`service_knowledge_consolidate.go`](services/backend/internal/app/service_knowledge_consolidate.go#L20-L165)).
Mas ele não registra uma decisão por duplicado nem exige proveniência na saída,
portanto o resultado não permite verificar se uma remoção foi deduplicação,
supersessão ou perda indevida.

Recomendação: executar uma consolidação deliberada do catálogo atual e ampliar
o protocolo de resultado com `merged_from`, `supersedes` e razão de remoção.
Manter o limite de não apagar tudo e a confirmação explícita para clear.

### P2 — Registos operacionais antigos não são automaticamente invalidados por mudança de arquitetura

O registo `chatgpt-worker-routing-and-response-latency` (2026-09-12) descreve
probes de Worker e latência de 60 s/30 s. A arquitetura posterior exige que o
Supervisor vinculado observe a resposta, inclusive oculto. Partes daquele texto
ainda são úteis (epoch, guarda antes do POST, viewport e correlação), mas a
atribuição de responsabilidade ao Worker está superada.

Recomendação: dividir registos mistos em factos atômicos com `applies_to`,
`observed_at`, `superseded_by` e uma classificação `normative`, `observed` ou
`hypothesis`. Na recuperação/retrieval, excluir automaticamente registos
marcados como superados.

### P2 — Alto volume de eventos requer retenção baseada em evidência, não descarte cego

O ledger contém cerca de 89 mil eventos em dez dias, dominado por output de
self-evolution e comandos. O requisito de preservar corpo de plano/execução
continua correto; descartar esses eventos para reduzir volume violaria
`AGENTS.md`. Porém, mensagens repetitivas de progresso podem tornar consultas e
contextos caros.

Recomendação: medir tamanho por tipo/sessão, aplicar retenção/compactação
somente a eventos de progresso que não são plano, resultado ou evidência de
falha, e preservar sempre uma síntese redigida, hashes e correlação. Validar
contra [`SoT/OBSERVABILITY.md`](SoT/OBSERVABILITY.md) e a regra de audit ledger
antes de mudar retenção.

## Sequência recomendada

1. Corrigir a topologia P0 com testes de criação e recuperação de seis
   Supervisors/três Workers; testar que uma seleção residente não navega.
2. Criar o histórico append-only de conhecimento e migração compatível, sem
   mudar a autoridade do catálogo atual.
3. Rodar consolidação com proveniência sobre a revisão 82; fundir duplicados e
   marcar explicitamente os factos de Worker superados pela topologia
   Supervisor.
4. Só então otimizar retenção de eventos, com métricas e testes de que planos,
   execuções, falhas e redacção permanecem recuperáveis.

## Limites da conclusão

O banco registra conhecimento por projeto. Conhecimento de outros checkouts
não deve ser incorporado ao Wharnex sem uma importação deliberada e verificada,
em conformidade com [`AGENTS.md`](AGENTS.md#L231-L236). A data mais recente
aplica-se aos textos ainda disponíveis; por desenho atual não é possível
recuperar o corpo de uma revisão já substituída apenas a partir do banco.
