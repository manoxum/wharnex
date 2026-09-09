# Modo Orchestrator — desenho aprovado para planeamento

- O terceiro modo do workspace deve chamar-se **Orchestrator**; **Planner** é o componente que converte um objetivo em proposta de Plan/DAG, enquanto Agent continua sendo o worker de execução.
- O fluxo é `User Objective → Planner → Draft Plan + Tasks → User Approval → Orchestrator → Agent Task Runs`. O resultado do Planner não executa nada automaticamente.
- O modelo durável é project-scoped: `Plan`, `Task`, `TaskDependency` e `TaskRun`. Plans/Tasks não devem ficar presos ao JSONB de uma Session; TaskRun referencia as Sessions/requests/plans executáveis do Agent.
- Task usa `PENDING | READY | DOING | REVIEW | COMPLETE | ARCHIVED`; blockers/readiness reasons são condição separada. Toda nova Task nasce PENDING e um evaluator determinístico pode promovê-la imediatamente a READY. Dependências formam DAG, ciclos são rejeitados e reabrir uma Task concluída exige revalidação dos dependentes.
- A decomposição do objetivo deve usar um protocolo próprio, por exemplo `harness.orchestrator-plan/v1`, separado de `harness.execution/v1`. Scope hints do Planner nunca substituem o write set real, Policy Engine ou ChangeSet Integrator.
- Overview deve privilegiar um Goal Composer espaçoso, proposal editor + approval gate e, abaixo, cockpit com slots, Active Work, Waiting/Blocked e Review. Tasks deve oferecer Kanban, Table, List e Graph sobre a mesma fonte de dados, mais criação manual e detalhe de Task.
- O Orchestrator nunca cria um caminho direto AI→shell. Cada Task Run reutiliza a pipeline Agent existente, incluindo protocolo, Policy, Protected/Unprotected e Apply.
- ADR-0025 e `projectExecutionQueue` hoje serializam execução por projeto. O V1 do Orchestrator deve preservar **1 mutation slot real por projeto**. Paralelismo real com 2+ slots deve ser uma evolução normativa separada, permitindo no máximo sandboxes concorrentes sobre immutable bases e mantendo integração no host serializada pelo ChangeSet Integrator.
