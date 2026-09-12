# Manual and hybrid conflict resolution

- A real integration or Git conflict pauses at an explicit operator choice; Wharnex does not dispatch the conflict to GPT automatically.
- The manual resolver exposes complete BASE, CURRENT and INCOMING content, with CURRENT as the patch base and an editable Result controlled by the operator.
- Hybrid delegation locks paths already resolved by the operator, removes them from the delegated capsule, rejects model writes to them, and injects the backend-generated human patch into the accepted plan.
- A fully manual integration resolution reuses the original conflicting candidates’ verification gates before host integration. Git-origin resolution instead replays and concludes the exact merge the operator started, as required by the Git surface invariant.
- An empty manual patch is meaningful when the operator keeps CURRENT for every resolved path; those manual decisions still retire the conflicting mutations or conclude the Git merge.
- Quando uma execução protegida falha depois de `git apply` mas antes do Apply no host, a ronda de reparação deve reenviar o patch cumulativo corrigido contra a baseline do host; um patch incremental contra o estado do sandbox falhado é inválido porque esse sandbox é descartado.
