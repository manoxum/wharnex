## Unreleased — Wharnex / WHX identity, concurrency and account lifecycle
### Chat fd279cb3-86e8-4042-b4c9-6d12845410ba (2026-09-24)

_(reserved — no entries yet)_


### Chat f83f50af-eff8-46fb-9271-c784361deedf (2026-09-24)

_(reserved — no entries yet)_


### Chat 003b2f47-7bed-4de8-aeb6-4b626cac3205 (2026-09-24)

- Refinado o visual dos cartões de Tarefas do projeto com hierarquia mais clara, estados destacados, resumo legível e metadados compactos, migrando essa superfície para Tailwind.


### Chat 009887b6-568e-497d-a8ec-e77b436ff105 (2026-09-24)

- Move a recuperação de vínculo da conversa para um controlo por ícone no cabeçalho do Engine, evitando que o painel apareça automaticamente após o envio de um prompt.
- Permite abrir o painel tanto para chats vinculados como por vincular, preservando a recuperação automática apenas quando falta um vínculo.


### Chat 6853076c-ece2-4584-a677-23f692150136 (2026-09-24)

- Corrige a consolidação do conhecimento quando o chat atual ainda tem um pedido ativo, isolando a manutenção num novo chat/sessão persistido do mesmo projeto sem substituir a identidade do pedido em curso.
- Impede consolidações duplicadas enquanto a própria manutenção de conhecimento está pendente e cobre a regressão no frontend.


### Chat ef6a2604-cc58-4090-83b8-ebff6acc176a (2026-09-24)

_(reserved — no entries yet)_


### Chat f6bc4f93-92dd-4c89-a2e4-9e4676d6b9be (2026-09-24)

- Redesenhado o dossiê de auto-evolução com três modalidades explícitas: Eventos, Conhecimento e Logs externos, incluindo importação dedicada e seleção combinável para análise.
- Atualiza os orçamentos autónomos de Esforço para Low 3, Medium 8, High 15, Extra High 20, Max 30 e Ultra 50, mantendo Loop sem limite numérico.
- Novos projetos e sessões passam a iniciar em High, incluindo o Desktop e o Remote, com os controlos e contratos do planner alinhados aos novos limites.


### Chat 417418ff-5def-4c90-aac6-bdd172a77b21 (2026-09-24)

_(reserved — no entries yet)_


### Chat 45c978a2-3e83-4f70-aaac-8e99cb010787 (2026-09-24)

- feat(git): add preflight per-file diff review before commit, push, pull and merge actions.
- feat(git): always open a JetBrains-inspired three-way conflict workbench, with GPT Only kept informational and manual/hybrid strategies editable.


### Chat 9bad6c3f-3e14-4eb3-b9ae-200469082173 (2026-09-24)

_(reserved — no entries yet)_


### Chat 16f4a870-eb30-46cf-9116-a180a53ef5dc (2026-09-24)

_(reserved — no entries yet)_


### Chat 5a56f66c-ba0a-443a-94f8-7afd08e8d00b (2026-09-23)

- Alinha o Wharnex Remote com as preferências visuais do Desktop através de um perfil de UI persistido no backend, incluindo tema, accent, escala, tipografia e densidade.
- Renova o webapp com tokens semânticos compatíveis com os temas Desktop e melhora sobretudo o ChatComposer, a leitura das mensagens, a navegação de chats, o emparelhamento e os painéis remotos.
- Mantém o Desktop como fonte da preferência visual e faz o webapp acompanhar alterações de tema durante a sessão remota.
- Evolui o cockpit remoto com hub de projetos responsivo, composer compacto com bandeja, directivas em chips, auto-hide e navegação rápida entre chat, ficheiros, plano e execução.
- Enriquece mensagens e anexos no chat, substitui a navegação horizontal dos painéis por um seletor acessível e adiciona atenção/notificações do navegador sem duplicar o runtime de browser do Desktop.


### Chat 8d218342-4904-40ab-821a-6fae7a2b667d (2026-09-23)

- Made execution failure attribution result-aware and canonical across the error ledger, terminal/infrastructure events, and attempt history, so structured resource exhaustion is not downgraded to generic cancellation.
- Delayed GPT execution-error resolution until the correction is integrated on the host, with idempotent restart recovery from durable applied evidence.
- Added a Protected npm manifest/lockfile completeness gate that blocks dependency-map changes which do not retain the matching `package-lock.json`, while leaving scripts-only edits unaffected.


### Chat 7f25311c-c6e7-4b18-920e-5c53191c38fd (2026-09-23)

- Added a single Nginx gateway on port 6969 plus a paired Wharnex Remote webapp, keeping AI browser automation on the Desktop through the durable supervisor queue.
- Split the paired remote UI into its own `services/webapp` React + Tailwind project and independent build/activation lifecycle; `services/frontend` is now Desktop-only.
- Added secure one-time pairing with hashed session tokens and remote-ingress authorization, documented in the architecture/security SoT and ADR-0071.
- Added pause, stop, resume, copy, open, pair and connectivity actions for tunnel instances, including durable stopped state and publication eligibility enforcement.
- Migrated the touched tunnel/pairing UI to Tailwind utilities and added focused backend/frontend coverage for pairing, remote proxying, tunnel control and remote dispatch.
- Evolved the paired webapp into a responsive Agent/Orchestrator cockpit with indexed projects, durable chats, QR scanning, notifications, tasks, TODOs, files, artifacts, Git, Docker and tunnel panels; remote requests are now queued as Desktop-owned Supervisor writes instead of running a second AI browser in the webapp.
- Fixed Remote project discovery to use a durable Desktop-open history instead of storage usage; Desktop opens are persisted server-side, legacy recent projects are seeded best-effort, and session history is merged so older worked projects remain discoverable.


### Chat f95a949e-f4eb-469b-b6a8-227fd2e546da (2026-09-23)

- Melhora o layout responsivo do contrato de execução em painéis estreitos, eliminando o grande espaço vertical causado por `flex-basis` desktop também na faixa intermédia em que o `plan-view` já empilha antes do breakpoint do histórico, e reorganizando ações/fallbacks em grelhas compactas.


### Chat 7ce671cd-0376-4853-a410-6f6ae819b4a6 (2026-09-23)

- Corrige a timeline do chat para projetar diretivas canónicas submetidas pelo ChatComposer como chips somente-leitura, preservando o texto canónico para cópia e transporte.


### Chat 1d2632d2-0ac5-4ac9-ab03-1eee0b547ec2 (2026-09-23)

- Corrigida a precedência visual das superfícies nativas ChatGPT: janelas internas e diálogos suspendem Supervisor/Workers enquanto estão abertos, interações de Worker respeitam blockers e a vista é restaurada ao fechar ou minimizar a camada.
- Fechado o gap de recarga do renderer: Ctrl+Shift+R, navegação main-frame e crash suspendem as superfícies nativas antes da troca do documento, e a deteção central cobre menus, popovers e backdrops visíveis que antes podiam ficar sob o Engine.


### Chat 30e2e96e-2ca0-44c5-a747-03d9020ba265 (2026-09-23)

- Centro de Alertas: notificações de tarefas concluídas passam a ser reconhecidas ao abrir, saem dos alertas ativos e ficam num histórico persistente por projeto.


### Estabilização do tray Desktop (2026-09-22)

- Corrige o ícone do tray e todos os glifos do menu, que eram imagens vazias. `nativeImage` só descodifica PNG e JPEG, por isso o candidato `.svg` instalado, o *data URL* `image/svg+xml` de recurso em `resolveDesktopIcon()` e cada `icon:` do menu do painel de controlo produziam uma imagem vazia: os ícones do menu nunca chegaram a aparecer, e num host sem o raster instalado o próprio ícone do tray desaparecia. O símbolo Wharnex e os glifos passam a ser rasterizados em processo para PNG real (`icon-png.mjs` codifica, `icon-canvas.mjs` desenha por *signed distance fields*), sem qualquer dependência nova. Comparado com a renderização do SVG pelo Chrome, o resultado é ~3× mais fiel do que o do ImageMagick (RMSE 0,050 contra 0,144).
- Deixa `scripts/install-dev.sh` de depender do `convert` do ImageMagick para produzir o raster 256×256 que o tray e a entrada `.desktop` preferem: sem ImageMagick no host, esse PNG simplesmente não existia e a entrada caía para o SVG. Passa a ser gerado pelo mesmo rasterizador através de `services/desktop/write-desktop-icon.mjs`, como `AGENTS.md` §11 exige de uma tarefa de ciclo de vida. `scripts/install-dev-check.sh` deixa de tornar essa verificação condicional.
- Impede que uma falha a criar o tray derrube quem a pediu. `ensure()` é chamado a partir do fecho-para-background e de `window-all-closed`; uma exceção aí deixava uma janela que se recusa a esconder. Passa a ser reportada e retentada no `ensure()` seguinte.
- Reconstrói o menu no máximo uma vez por janela de 150 ms e ignora a reconstrução quando nada do que é desenhado mudou. O *polling* da sessão e a difusão do estado dos agentes chegam ambos ao tray, pelo que um projeto ocupado reconstruía o menu várias vezes por segundo — no Linux isso reexporta o menu DBus inteiro e pode fechar um menu que o operador tem aberto. Os glifos passam também a ser criados uma só vez por nome/cor em vez de um `NativeImage` por item por reconstrução.
- Liberta o estado de um projeto fechado (`forgetProject` existia mas nunca era chamado, pelo que o menu mantinha o estado de projetos mortos e o mapa crescia durante toda a vida do processo) e destrói o tray em `before-quit`, para o ícone não sobreviver ao processo no painel do Linux.
- Mantém por ler uma notificação que não conseguiu chegar ao seu projeto. Era marcada como lida antes de a janela responder, por isso deixava de contar como não lida e o clique no tray nunca mais a oferecia.
- O ícone do tray passa a ser pedido a 22 px no Linux (o tamanho de painel do `hicolor`) e a 16 px nas outras plataformas, com `quality: 'best'`, em vez de um redimensionamento fixo para 18 px a partir de 256 px.
- Aplica a mesma correção ao ícone do *splash* do lançador, que tinha exatamente o mesmo recurso SVG vazio.


### Chat ca38be4e-f983-46fa-890e-df7d488ba348 (2026-09-22)

- Evolui o tray Desktop para um mini painel de controlo com cor por projeto, ícones de ação, notificações, estado/pausa de Workers, controlos rápidos de plano/execução e acesso ao painel de túneis.


### Chat 1e7615d9-fa36-43eb-b015-e20dbb1907a5 (2026-09-22)

- Padroniza a toolbar dos painéis laterais com controles de fechar, A−, A+ e recarregar no canto superior direito, incluindo escala de texto persistente por painel.


### Chat d2a78190-5e16-4fa9-80d8-819ef846003e (2026-09-22)

- Evolui a Policy para transformar comandos de alto impacto em aprovações informadas, com argv/motivo/efeitos/impacto visíveis, em vez de forçar uma ronda de reparação do GPT.
- Adiciona o modo manual `Full` para execução direta no host, mantendo `sudo` fora da aprovação automática e protegido por confirmação explícita e senha efémera não persistida.


### Chat ce7abbc3-364c-487b-ae37-936e0641abd0 (2026-09-22)

- Replace automatic self-evolution restart dialogs with completion notifications, accumulate ready restart reports across chats into one service-union activation, surface successful host integrations as informational notifications, and mirror completion notifications into the Desktop tray/native notification flow.


### Chat 9ef77188-f590-4240-8714-61ac41b0deb9 (2026-09-22)

- Add a persistent desktop tray lifecycle with explicit background/project/all-project close choices, per-project tray restore/close actions, recoverable multi-project shutdown state, restored window geometry, editor tabs/view positions, and best-effort terminal tab/history/workdir/scroll recovery while preserving durable chat data when a workspace session is discarded.
- Fix the Linux tray glyph so it reuses the installed per-instance Wharnex raster icon (with installed SVG and generated SVG fallbacks) instead of relying first on an SVG data URL that can render as a generic three-dot placeholder.
- Replace the native synchronous close confirmation with a themed Wharnex modal that keeps the main process authoritative over background, current-project, full-session exit, and cancel decisions while hiding native ChatGPT surfaces behind the modal.
- Replace the native session-recovery message box with a themed Wharnex modal and restore the workspace lazily behind a skeleton. The old prompt was native because it ran at startup before any window existed, and it asked once per project through a blocking `showMessageBoxSync`. The saved windows are now recreated immediately — so the startup sequence, the persisted layout and the agent-scheduler bootstrap all stay synchronous and unchanged — but they open with their projects unbound and `pending`, and each window asks for the decision once, in its own modal, listing every project the session would restore. Recovering then acquires the projects lazily. The blank panel that appeared while a restored project booted is gone too: `.bound-project-frame` was painting a hard-coded `#eceee7`, which reads as a white window on a dark theme, so the stage now follows the theme token and the shared `WorkspaceSkeleton` holds the space until the project reports itself ready. Those stage rules were extracted out of the frozen legacy monolith into `styles/domains/workspace-shell-stage.css` under the extract-on-touch rule.
- Move the six legacy root stylesheets out of `src/` into the `src/styles/` domain that `SoT/FRONTEND_STYLING.md` §4 reserves for them, which that section had been holding for an explicit request rather than a drive-by. `styles.css` becomes `styles/legacy/styles.css`, `theme.css` becomes `styles/theme/theme.css`, and the four surface sheets move under `styles/domains/`, leaving no stylesheet at the root of `src/` at all. `main.tsx` now imports the single `styles/index.css` entry point instead of seven separate files, and that index reproduces the exact order those imports applied, because the cascade is what decides appearance. The move is content-preserving — the files were relocated with `git mv` and the production CSS bundle hashes identically before and after — and relocation does not unfreeze them: no rule may still be added to any of the six.
- Fix that themed close confirmation taking the whole Desktop shell down with it. Satisfying the 200-line cap had moved part of the preload into a sibling module, but Electron loads that preload inside a `sandbox: true` window, where `require` is a polyfill resolving only `electron` and a few Node builtins: the relative import threw, the preload aborted before `contextBridge.exposeInMainWorld` ran, and `wharnessDesktop` was never exposed. The trusted renderer therefore fell back to web-only mode — no themed title bar or window controls, no native ChatGPT surfaces, no project binding — and because the new close handler cancels the native close while waiting for a renderer that could never answer, the window could not be closed by any button at all. The preload is self-contained again, a contract test now rejects any specifier a sandboxed preload cannot resolve, and the close coordinator escalates to the native prompt when publishing to the renderer fails or when the renderer never reports the modal on screen — so a renderer failure can never again leave a window that refuses to close. That escalation deliberately bounds the renderer's acknowledgement and not the person's decision: the modal acknowledges itself as soon as it mounts, which disarms the fallback, because timing the decision instead opened the native dialog underneath a modal somebody was still reading. `SoT/CODE_QUALITY.md` records why a sandboxed preload is exempt from the line cap and where its behavior belongs instead.


### Chat 86aa9548-a1b2-412f-ae42-50680a6f3b92 (2026-09-22)

- Replace the contributors tab first-load sentence with a geometry-matched skeleton for the summary, calendar, activity chart and contributor cards, reusing the shared reduced-motion-aware loading primitives.


- Make every build/install lifecycle command reclaim obsolete storage instead of only pruning what the backend could already see. `make build` ran the backend's ownership-aware prune, but that sweep recognized only two of the five temporary prefixes Wharnex creates, so leaked request-base extractions, changeset snapshots and attachment stores accumulated forever in the checkout-private temporary root; nothing at all reclaimed settled self-evolution transaction snapshots, unbounded lifecycle logs, or the Docker layers and build cache every rebuild orphans. On the checkout this was measured against, that was 3.2 GB of private temporaries, 1.6 GB of retired transactions, a 15 MB single log file and over 23 GB of reclaimable Docker layers and build cache. Reclamation now runs as a stage of `make build` — and therefore of `make build-all`, `make build-refresh`, `make install-dev` and the `make start` path that rebuilds a stale checkout — split by what each side can prove it owns, with `scripts/storage-reclaim.sh` as the new host-side half. It is obsolescence-proven, never a cache wipe: valid fingerprinted dependency/artifact caches, persisted sessions, request history, live sandboxes, the self-evolution transaction the status file still names and the immediately previous image generation the rollout rolls back to are all retained, and the stage never fails the build that ran it. Anonymous Docker volumes stay opt-in behind `WHARNESS_RECLAIM_VOLUMES=1` because they are machine-global and a third-party image that declares `VOLUME` without a named mapping keeps real data in one; named volumes are unreachable from that sweep by construction. The desktop attachment-store test, which leaked one temporary store per run into that same root, now removes its own.

- Stop a conflict-resolution chat from looping forever on an incomplete `harness.conflict/v1` capsule. `SoT/AI_PROTOCOL.md` already required a failed candidate to enter the dedicated conflict path before generic repair, and `ADR-0054` copies the same capsule forward when a focused resolution fails local verification against an unchanged path set; two related gaps around it were not covered. First, when the planner's own turn for a conflict-resolution request completed as `failed`/non-retryable, the session fell through to the generic text-only "FRESH REQUEST RECOVERY" retry with no capsule attached at all, and every subsequent round was equally capsule-less, so the session settled into the generic `planner_guidance_required` bucket, which asks an operator for guidance that cannot exist. Second, the conflict thread's own recorded path set is a snapshot: the host can move further paths of the same candidate out of sync between rounds, and a renewed capsule that still trusted the stale snapshot kept getting rejected for the same reason it was renewed to fix. `conflict_capsule_stale` is now its own classified `FailureKind`, recognized retroactively from a session already stuck under the generic bucket, with a dedicated recovery (`RenewConflictCapsule`, `POST /api/sessions/{id}/conflict-capsule-renew`) that rebuilds the capsule from the conflict thread's own recorded paths/sources and the live host HEAD. Before rebuilding, an offline `git merge-tree` preflight against the live host — never planner prose, never a patch tool's stdout — is what now decides whether the thread's path set needs widening, both for this dedicated recovery and for the ordinary automatic replay-retry path, which reserves `ADR-0054`'s cheaper byte-identical resend for a genuinely unchanged path set. See `adr/ADR-0065`.
- Make automatic `keep continue` delivery recovery a one-shot wake-up: exact response-ZIP validation now immediately quiesces queued/in-flight provider recovery, the send path re-checks terminal state at dispatch, and the planner protocol treats post-delivery wake-ups as a no-op.
- Order project TODO cards by classified urgency inside each state tab, from very urgent through no urgency, while leaving not-yet-classified items after the ranked entries and preserving their existing relative order.
- Keep large user prompts compact in the transcript until explicitly expanded, and coalesce virtual-window updates to one animation frame so rapid scrolling does not force a React state transition for every native scroll event.
- Stage older chat transcript hydration behind fixed skeleton shells while keeping the newest interaction window immediately usable: deferred entries wait until they approach the viewport, then hydrate one per animation frame with newest-eligible priority.
- Reduce chat renderer main-thread and compositor work without removing transcript functionality: composer drafts now debounce synchronous localStorage writes and lazy-load initial state, collapsed long Markdown parses only a bounded preview until expansion, closed WHX notices defer rich-body hydration, returned-artifact galleries no longer refetch presentation metadata when only object identity changes, and the collapsed fade no longer uses backdrop blur.
- Make the terminal a full-width, vertically resizable bottom workbench that keeps live PTYs across same-project Session refreshes. Editor run actions now create a new Host terminal directly, Host selection no longer adds a second confirmation modal, project-tree file clicks open directly in Editor, the full file mutation toolset remains available, and all application scroll surfaces use one theme-aware scrollbar treatment.
- Restore the themed renderer-owned window controls so project, branch and workspace actions stay in the same header as minimize, maximize and close. Linux uses software compositing; hidden ChatGPT Workers start sequentially after the local shell paints and stay detached from its native compositor until explicitly surfaced, avoiding the renderer crash that made the application appear to restart during startup.
- Make one informed Protected execution decision the complete authorization boundary for sandbox execution and post-verification host integration in both Manual and Auto automation modes. The engine no longer gates automatic integration on Auto, the Plan/attention surfaces no longer expose a normal **Aplicar no host** approval, and host Apply remains user-visible only as failure recovery without another confirmation prompt. Policy-expanding correction waves still require a fresh informed execution decision, which again covers their eventual host integration.
- Refine the Git and Plan surfaces around operator readability: the branch quick-switch popup now uses an opaque themed surface with a legible version badge, commit-history branch scope uses a native multi-select instead of chips, branch switch actions align as compact icon buttons, Chat files get a cleaner card/search hierarchy, and the Plan tab becomes theme-safe in dark mode. Planned patches are summarized per file and open the shared Monaco before/after diff; the same Plan surface can persist raw fallback patches under project-root `patches/` and copy a safely quoted manual apply/verification batch.
- Replace the multi-project shell's instance/version badge with the active project's working branch and root project version. The same Git badge now exposes switch/fetch/pull/push from the shell, receives the embedded project's Session identity through a same-origin bridge, and refreshes the child Session after mutating Git actions so pull/push conflicts surface immediately in the existing manual/GPT resolver. The Version Control drawer keeps the same operations and its one/many/all-branch history scopes.
- Enrich Git-origin `harness.conflict/v1` intent without breaking v1 consumers: side commit entries may now include bounded commit bodies, `Request-Id` provenance and the matching durable user prompt, while bounded BASE→LOCAL and BASE→INCOMING diffs expose surrounding intent beyond the conflicting files. All new fields are optional, missing provenance is omitted rather than guessed, and the capsule stays on protocol v1 with no migration required.
- Compact the fixed chat header context block: keep hash/chat ID available only through the copy action, move the current state and **Exportar ZIP** into the same context cluster, and preserve the Agent default split at 60% chat / 40% inspector when the activity drawer is closed.
- Make the canonical `make build` lifecycle materialize the configured local Protected runner image. Fresh machines no longer finish compiling the application only to have Docker interpret the absent `kernl-runner:local` image as a registry/login request during the first Protected execution. Transactional self-evolution remains on `make build-stage` and therefore cannot replace its own verification runner; `make build-runner RUNNER_IMAGE=...` remains available as a direct recovery target.
- Fix Host PTY project scripts reporting `./bin/promote: not found` even though the file exists. In the Compose runtime the Host PTY is spawned by Wharnex's backend control container over the real mounted home/project tree; that image had Docker/Git/Node tooling but no `/bin/bash`, so any executable whose shebang was `#!/bin/bash` or `#!/usr/bin/env bash` failed at `execve` and `/bin/sh` reduced the missing interpreter to the misleading "not found" message. The backend runtime now installs Bash plus completion and Compose pins `SHELL=/bin/bash`; the terminal contract is corrected to distinguish real host-file authority from backend-image toolchain parity.
- Finish the human PTY developer environment instead of stopping at a raw xterm session. The Protected runner now carries Python/Pip, PHP/Composer, CMake/Ninja, database clients, shellcheck, fzf, tmux and zsh in addition to the existing Go/Node toolchain; Bash and zsh load image-owned completion profiles, keep sandbox history across reconnects, support prefix history search, and expose writable per-session package caches/project-local binaries. Network clients remain intentionally absent; model Policy is tightened for the new human-only package managers, database clients and interactive helpers, so the extra capabilities belong only to the explicitly human terminal unless an executable is deliberately Agent-safe. The runner image is refreshed by the canonical `make build`; `make build-runner` remains available when only that image needs rebuilding.
- Stop successful Agent work from ending with `Invalid ChatGPT cache key`. The runtime-state projection validated an absent `task.chat_id` as though it were a supplied key whenever a Supervisor stayed bound between claims, so routine state refreshes threw repeatedly and could make the bundle ACK report an error after the bundle had already downloaded correctly. Optional scheduler fields now preserve absence while every non-empty key still passes the strict allowlist, and diagnostic refresh failure can no longer reject an otherwise successful cancellation or bundle ACK.

- Let one Agent analyze several bound Git projects from a single workspace. The project rail now accepts a complete absolute path, sends the bound-project inventory to the active project, and builds one namespaced context archive with a workspace-wide transport hash. The primary repository still owns the plan and its baseline hash; every related repository keeps an independent Session, Policy decision, Protected sandbox, verification result and explicit Apply, so switching projects can implement the coordinated follow-up without sharing mutation authority.
- Run path-scoped read-only Git verification inside the initialized submodule that owns every pathspec. A root-level `git grep -- services/admin/...` sees only the gitlink and previously produced a false unchanged-baseline result, then failed after merge and rolled Apply back. Verification now rewrites eligible `grep`, `diff`, `log`, `ls-files` and `status` commands to the deepest owning submodule while leaving mixed-root or magic pathspec commands unchanged.
- Keep self-evolution rollback automatic when Git merely commits the operator-dirty bytes the transaction already captured. The rollback guard previously treated any touched-path overlap between its pre-transaction SHA and current HEAD as unrelated work, including `MergeBranchOnHost`'s own preservation snapshot; transaction `txn-20260913T111106-6127f80c0211` proved the false positive because `requestbase.go` in commit `51c4ab0` was byte-for-byte the transaction backup, yet the engine parked permanently in `rollback_failed`. Overlapping paths now remain safe only when live existence, mode and bytes exactly match the captured backup; genuinely divergent content still fails closed. Self-evolution staging also replaces util-linux-only `flock -w` with portable bounded `flock -n` polling, because the backend's BusyBox rejected `-w` and falsely reported a lifecycle timeout after every source/test build had passed. Apply-to-GPT escalation is now closed opt-in: only a candidate defect explicitly identified after local rollback may create a repair request; active-turn guards, coordination/persistence errors and unsupported host utilities retain the candidate locally. A durable `host.applied` event or a hydrated applied session now reconstructs the final Main Request summary and diff card idempotently, so a background/manual API Apply cannot leave the chat showing only “Alterações aplicadas no host”. The chat header labels the context hash and Harness chat ID and copies both complete identifiers from one accessible control.
- Handle projects with Git submodules instead of refusing them. A change that writes inside an initialized submodule is now verified with that submodule present as a real repository, committed deepest-first so each parent records its child's gitlink, and applied by advancing each submodule on the branch it was already checked out on; failure resets the superproject and restores those branches to their recorded base commits, so Apply stays atomic. This retires the previous contract, which rejected every write inside any submodule at ingestion and told the operator to open that submodule as a separate Wharnex project — correct for the mechanism as it then existed, and useless for the projects that actually hit it: a deployment superproject whose entire source lives in `services/app`, `services/portal` and `services/server` could receive no change at all, and the reported failure was a one-line `Dockerfile` fix the planner had already written correctly. Two implementations of this reached the tree independently; the one with more testing and production exposure (`internal/sandbox/repositorytree.go`, `adr/ADR-0039`) was kept and the other removed, because carrying both is exactly what `AGENTS.md` §4 forbids. What the removed one contributed and the kept one lacked was folded in: the advisory superproject preflight now excludes the gitlinks of the nested repositories the same candidate owns, so a pointer the Apply is itself about to move is no longer reported as a conflict a planner is asked to patch. Separately, a new `wharness.repository/v1` manifest travels with every planner request for a project that has submodules — and only then — describing each repository's HEAD, branch or detached state, recorded pointer and whether a patch can be delivered there, without publishing repository URLs; see `adr/ADR-0050`. `submodule_write` survives, narrowed to the case where it is still true: a submodule with no usable checkout has no repository to commit into, and the remedy is `git submodule update --init`.
- Publish the project's own test harness to the planner, so a generated test stops asserting with matchers the project does not have. A self-evolution round wrote `toHaveAttribute` — a jest-dom matcher — in `services/frontend`, which has never depended on jest-dom; every neighbouring assertion in the same file uses `toBeTruthy()`. Vitest reports it as `Invalid Chai property`, which reads like a defect in the change rather than a missing capability, and a full model turn, container run and verification suite were spent to discover it. The `wharness.environment/v1` manifest already published the runner image's executables for exactly this reason; it now also publishes, per package that declares a test script, the test command, the detected runner, the declared testing libraries and the assertion extensions actually registered. An empty `assertion_extensions` list is the load-bearing case and is stated affirmatively rather than omitted: it means only the runner's built-in matchers exist. Measured from the project's own package manifests, bounded in depth and count, and recognising matcher packages from an explicit set rather than a heuristic — publishing a matcher set the project does not have is the exact mistake the section exists to prevent.
- Give every exclusive resource Wharnex holds a published way out. Two failures in one self-evolution chat shared a single shape: a global lock held in a state that named no remedy. The index-lock fix below is one; the other is a self-evolution transaction parked in `rollback_failed` — a phase that deliberately fails closed so a human can recover — which then refused every later self-evolution with "another Wharnex self-evolution transaction is already active", naming no phase, no transaction, no cause and no action, while no endpoint existed to clear it. The refusal is now typed and explains itself: the phase, the transaction, the plan that left it, the recorded cause, and the action that releases it. `GET /api/self-evolution/block` reports the same state, and `POST /api/self-evolution/block/release` is an explicit human release that must name the exact transaction, refuses any phase that is still active or extendable work, and keeps the transaction directory as the evidence for whatever recovery was performed. The same reasoning is extended across every host Git write: refused repository ownership (`safe.directory`), an unwritable repository and a full filesystem now classify as `host_working_state_blocked` alongside the index lock, so none of them can reach the repair loop and ask a planner to fix a filesystem.
- Stop spending AI repair rounds on a locked Git index. An Apply into a repository whose `index.lock` is held — by a concurrent Git process, or left behind by one that crashed — failed with git's raw message through the generic error path, which classified it as a defect in the generated change and launched an automatic correction round. No patch can remove a lock file, so the round was unanswerable and the next Apply reproduced the same failure; a `flowKey-deploy` chat sat in that loop against a zero-byte lock six hours stale. It is now the typed `host_working_state_blocked` refusal it always was: the verified candidate is retained, no repair round is consumed, and the operator is given the lock's path and its age — which is the only thing that distinguishes live contention, where the answer is to wait, from a crash leftover, where the answer is to delete it. Wharnex still never deletes the lock itself, because removing one a live process holds corrupts that process's write.
- Reclaim abandoned sandbox workspaces that hydrated Go dependencies. The Go toolchain makes every cached module file **and its containing directories** read-only, and unlinking a file needs write permission on its parent directory rather than on the file, so `os.RemoveAll` failed with `permission denied` on any such directory. That failed the whole storage prune, which failed `make build`, every time — while the directories it could not delete accumulated forever. Owner-write is now restored on directories before the tree is removed.

- Bind one Supervisor to one chat, and stop paying ChatGPT for switching between them. Rate limiting survived every pacing, cooldown and backoff control already in place, and two measurements located what was left: it began when the Supervisor/Worker topology was introduced, and turning the Worker pool off entirely did not stop it — Supervisors alone still earned 429s. Two Supervisor slots served an arbitrary number of Harness chats, so selecting a third chat evicted a resident conversation and loaded the new one, and selecting the first one back loaded it again. Each of those loads is a real authenticated request with no work attached to it: churn produced by the operator alternating between conversations. The pool is now six Supervisors and three Workers (was two and six), and a Supervisor slot stays bound to its chat for the life of its request — it releases only when it holds nothing unfinished *and* another chat is waiting for a slot, so there is no idle reaper and no timer that would reload the conversation next time it is opened. Selecting a resident chat is therefore a visibility change and performs no navigation at all. Supervision follows the binding: the main-process bundle poll now runs for every bound Supervisor rather than only the painted one, which is what removes the navigation a Worker would otherwise make to a page that is already loaded. The durable queue is partitioned by pool role at the claim — Supervisors take `AWAIT_RESPONSE`, `BOT_WRITE`, `RECOVERY_WRITE` and `ORCHESTRATOR_PLAN` for chats created by both the Agent and the Orchestrator; Workers keep renaming, organizing, archiving, deletion, library cleanup, titles and translation — enforced in the claim rather than after it, because a claim charges an attempt and a rejected routing decision would otherwise spend a task's own retry budget. A rename can no longer take the renderer a live request needs, and an explicit operator pin still overrides the partition so a pinned task is never reachable by no pool at all. Memory is the acknowledged cost: up to nine remote renderers against eight, and the slot count is the explicit control the original one-renderer-per-chat design lacked. See `adr/ADR-0049`.
- Stop shipping the context bundle uncompressed. A greeting sent to `flowcore-deploy` uploaded a **21 MB** attachment; ChatGPT's upload timed out on it four times before finally succeeding, which is where the twenty minutes went (`[chatgpt-upload] retry ... error=ChatGPT did not start the file upload before timeout`, four times, then `confirmed`). The scan itself took one second — the cost was entirely in the payload. The bundle was written with `zip.Store`, so the archive was the raw byte sum of every included file, even though it is overwhelmingly source text; measured on that project's own sources, deflate takes 7.66 MB to 1.95 MB. Text is now deflated and non-text still stored, which keeps the original "no recompression" contract intact: deflating already-compressed media spends CPU to gain nothing, while source text has never been compressed before. Bundle identity is unaffected — the manifest SHA-256 comes from paths and content hashes, never the archive bytes — and the size budgets keep counting raw content, because they bound what the planner reads rather than what the transport carries.
- Prune IDE metadata and generated test output from project context. `AGENTS.md` §10 already asked for both and neither was ever named, so one project carried 0.92 MB of JetBrains datasource XML plus 0.9 MB of Playwright report and failure screenshots into every single request. `.idea`, `.vscode`, `playwright-report`, `test-results` and `.nyc_output` join the mandatory exclusions, and `.tsbuildinfo`/`.lcov` join the blocked extensions — both are generated text, so they passed the binary check and reached the planner as though they were source. `.sql` was deliberately left out: migrations are project source, and this list cannot be reopened by project configuration. Together with compression, the measured bundle for that project falls from 21.13 MB to 5.19 MB.

- Keep archived chats archived across a restart. Archiving wrote to localStorage and archived the *session*, but never the durable chat row's `archived_at`; hydration merges the durable record over the local one and the durable record wins, so every chat archived after it became durable reopened on the next start. Only rows pushed by the original one-way migration carried the flag at all — which is why both instances held exactly 30 archived rows, the renderer's `slice(0, 30)` bound frozen at migration time. A generic save may no longer clear `archived_at` (the same defence `adr/ADR-0047` gave the conversation binding, and the same omission bug underneath), archiving and restoring go through an explicit `PATCH .../archived`, and archiving twice no longer moves the timestamp.
- Let large projects send a prompt at all. Every send in `flowKey-deploy` failed, and the Desktop log named it exactly: `Prepared prompt exceeds 1 MiB limit`. The prompt embeds the context manifest so the planner can resolve the paths it will touch, and that project's manifest held 14,468 files rendering a 5.8 MiB prompt — so all five of its chats were left unbound, because the send never happened. Two causes stacked. The inventory was 98.9% dependency payload: 58,894 of 59,518 files live under `.pnpm-store` and similar package-manager stores, which are `node_modules` under a different name and were not pruned; they are now. And the inventory had no bound at all — Wharnex's own repository measured 862 KiB, 84% of the cap, days from the same failure. The rendered manifest is now capped well below the transport limit, truncated deterministically when it does not fit, and always declares the truncation: how many entries were dropped, where the complete inventory still lives, and that absence from the list is not evidence a file does not exist, so a planner cannot read a shortened list as licence to recreate a file that already exists. See `adr/ADR-0048`.

- Stop ordinary chat saves from silently destroying a ChatGPT conversation binding, and give a broken chat a way back. `PUT /api/workspace-chats/{id}` is a full replace, while the renderer omits `chatgpt_url` entirely whenever its own in-memory copy has none — and omission decoded as `""` is indistinguishable from a deliberate clear, so the binding was erased along with the `conversation_id` derived from it, leaving nothing in the row to recover from. The blast radius was the real problem: `persistChats` re-PUTs every chat in the bounded list on any list mutation, so renaming one chat rewrites all thirty and unbinds any whose copy happened to lack the URL — visible in the statable instance as a single bulk write touching 26 chats at 2026-09-12 18:18:44. An unbound chat then opens the ChatGPT home surface and is indistinguishable from a new one. A save may now establish or change a binding but never drop one, enforced in the durable store rather than in one renderer path, with unbinding reserved for the explicit remote action the affinity invariant already describes. `GET /api/workspace-chats/{id}/binding-recovery` reconstructs candidates from Wharnex's own records — the browser-agent queue for that chat, its transcript, its session events — labels which evidence produced each, marks a conversation another chat already owns as a conflict rather than offering it, and proposes only: the operator confirms, or pastes the address when no evidence survived. See `adr/ADR-0047`.

- Scope the browser-agent queue to the project it is shown in, and the claim to the projects a window actually has open. One durable queue and one agent pool serve every project, and neither was partitioned: **Tarefas** listed the whole account, so two projects open side by side each saw the other's chats, request ids and lineage while answering a question about a backlog the operator was not looking at; and a Worker could spend the shared pool on a project closed hours ago, whose chat nobody can see, whose response nobody can read and whose attention nobody can give. Underneath both sat a third defect: `project_id` was not a project. The Orchestrator wrote the canonical host path, the Desktop transport wrote the *ChatGPT project display name* — a label renameable from ChatGPT's own UI — and the translation utility wrote nothing, so no filter could have worked. Attribution is now resolved by the store at enqueue (an absolute path is kept, anything else discarded, then resolved from the task's own chat and failing that its session), the panel and its aggregate are filtered by the same project, and the durable claim admits a task only when its project is open in some window. Account-lifecycle work — `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_BUNDLE`, `DELETE_TEMP_CHAT` — is exempt, because the chat-deletion convergence rule requires it to reach the remote conversation and its bundles whatever is open. Scoping is a claim predicate rather than a claim followed by a release, so no attempt is charged to reject work, and closing a project interrupts nothing already leased. Because the pool stays shared, the **Agentes** panel now names the other project an agent is busy with and the task panel reports other projects as a bare count, so a busy pool no longer reads as a broken one. See `adr/ADR-0044`.

- Stop a base-rooted request inventing a new dependency cache on every run. `adr/ADR-0035` made rooting a request at its own immutable base the normal path, and that base is materialised by extracting the context archive into a temporary directory — which was then handed to `Runner.Prepare`, which derives the private Go module cache key from the tree it receives. Every such execution therefore keyed a brand-new cache, the project's own populated one became unreachable, and hydration fell back to the Wharnex runtime's `GOMODCACHE` (`/go/pkg/mod`, which does not exist inside the control container), failing with `offline sandbox dependencies unavailable: host Go module cache is unavailable` and demanding a human network approval that then wrote ~144 MB under a key nothing would ever read again. Measured on this instance: eight cache directories, only one matching a real project root, the other seven ≈144 MB each and created at the exact timestamps of the observed stalls. Four chats hit it, the last at 2026-09-13T00:00:11Z with its retry 24 seconds later failing identically. An earlier fix attempt existed (`bindExecutionDependencySource`) but rewrote the identity *after* preparation, by which time the key was already bound. Preparation is now told the canonical project up front, and the diagnostics name the machine actually measured instead of calling a container "host". See `adr/ADR-0045`.
- Let a change that creates a file reconcile from its own request base. Archive completeness required every patch path to be present in the immutable context archive — including paths the patch *creates*, which cannot be in a snapshot taken before they existed. Reconciliation was therefore structurally impossible for any change adding an ADR, a Go file or a test, and the fallthrough differed only in how it hurt: a patch-only plan was retargeted onto the drifted current tree by the legacy rebase (all three `patch does not apply cleanly` failures in the corpus were preceded within seconds by `changeset.execution_legacy_rebase`, a 3/3 correlation, and each consumed a repair round the change protocol already forbids), while a command-bearing plan was rejected outright with `stale command plan cannot be reconciled without its immutable request base`, discarding three complete bundles. Six rounds from one predicate. Completeness is now measured against what a patch modifies, reads and declares as a barrier; created paths are exempt and are withheld from base hydration too, so a peer's colliding creation is decided by the three-way merge at Apply rather than by a patch error.
- Reject a change bundle that declares a file it never ships. Two bundles declared `impact_files` they did not deliver and both failed in the sandbox with undefined-symbol compile errors — `undefined: DebugRun`/`DebugEvidence` from four undelivered definitions, and `undefined: normalizeChatAgentWorkerID` from one. None of those five paths ever existed in the repository, so each was a promised new file that never arrived; in the first case the previous round's attempt ledger had already named those exact four files as a hard exclusion and the next round omitted them anyway. Such a bundle is now refused at ingestion, before Policy and before sandbox verification, publishing `bundle.incomplete_impact_files`. The rule is narrow on purpose — the path must be both undelivered *and* absent from the project — so over-declaring an existing file stays ordinary forecast imprecision, and it fails open on anything it cannot resolve. Across every archived bundle it had two detections and no false positives.

- Stop a gap in Wharnex's own container from destroying a verified change. Post-merge verification re-runs a plan's gates against the merged host tree, but it runs through the host runner — an in-process `exec`, and so the backend/control container — while the very same gates were verified in the runner image, which installs `build-essential`. That container had no C compiler, so its `CGO_ENABLED` resolved to 0 and `go test -race ./...` died in 5 ms with `go: -race requires cgo; enable cgo by setting CGO_ENABLED=1`. Wharnex read exit 2 as a verification failure, reverted the host to the pre-merge commit and spent a repair round asking the planner to fix source that was never implicated; the retry failed identically, because no patch adds a compiler to the container Wharnex itself runs in. A gate the host environment cannot run at all now returns no verdict rather than a failure: it is recorded as unverified on host through `integration.verification_unsupported`, named in the terminal `host.applied` event, and integration continues on the Protected verdict that gate already produced against this exact candidate. The classification reads the failing command's own output and fails closed — an ordinary failure, a detected data race, a compile error or a runner error still reverts the host. Skipping is the fallback, not the intent, so the control container gains `build-base` and the cgo-dependent gates run for real. See `adr/ADR-0043`.
- Enable **Auto scale** and global **Keep flowing** by default for new runtime policy state, while preserving explicit operator opt-outs. Auto scale now has persisted, UI-configurable ceilings and fills the unmet claimable demand of both Supervisor and Worker pools in one reconciliation instead of waiting for every free slot to disappear first; legacy policy files with no `auto_scale` field inherit the enabled default, while an explicit `false` remains an opt-out.
- Attribute a failing verification suite failure by failure instead of by exit code, and tell the planner which failures are its own. `go test ./...` puts every package behind one exit status, so the baseline comparison — which existed, but only understood TypeScript diagnostics — was blind to Go and gave up the moment the two runs differed at all. A repository whose suite already failed for an unrelated reason therefore handed that failure to the planner as though the candidate had caused it. Measured on chat b0ceb726e438: a stale `## Wharness status` assertion, left behind by the completed Wharnex rename and already fixed on the host, failed inside a request base captured hours earlier; three repair rounds later the planner was patching `exportmeta/metadata.go` to revert the rename and make the stale assertion pass. Failures are now fingerprinted per Go test, per Go package (including a package that fails to build, which emits no per-test line) and per TypeScript diagnostic; a run that introduces nothing new is a pre-existing failure and no longer fails the candidate, and when it does introduce something the repair diagnostic names both sets and says plainly that the pre-existing ones must not be touched.
- Forbid making a gate pass by changing what it verifies. Relaxing an assertion, deleting a test, reverting an accepted change or renaming a symbol back so a stale expectation matches goes green while destroying work that was already accepted, and it passes every structural check on the way through. The change protocol now states that a failure the change did not introduce is not that change's to fix, that a bundle whose only remaining failures are pre-existing is complete, and that a genuinely blocking pre-existing failure is `kind=blocked`, not a silent repair.

- Stop autonomous workers interrupting a response that is still being written. A conversation with a live `AWAIT_RESPONSE` was not protected from account work, because the per-conversation lease lock only holds while a task is leased and supervision spends almost all of its life in `WAITING` so the worker is released between observations — a 30-second window, every cycle, in which another task could claim the very conversation the model was writing into. Measured on this instance: `ORGANIZE_CHAT` ran 17:42→18:40 against the exact conversation whose supervision ran 17:43→18:46, and that request ended with no bundle. Every one of those tasks drives the generating renderer — organizing clicks a project anchor, which is a real `/g/g-p-…` navigation; archive and delete click ChatGPT's own Stop control; the temporary-title fallback sends the worker to a brand-new chat and submits an unrelated prompt there. The claim query now keeps such a conversation quiet until its response settles, and a supervision past its attempt budget is excluded so a dead await cannot silence a chat permanently.
- Keep the supervising slot on its conversation between observations. The idle-release added alongside this work would otherwise have read the deliberate 30-second gap as a dry lane and handed the conversation to another slot, which would reload a page the model was still writing into.
- Require evidence that a turn actually ran before declaring it finished without delivering. The grace window is measured from the moment the generating indicator disappeared, which presupposes it was seen; when it never was, the window degraded to "the page has looked static since we first looked" — equally true of a turn that has not started, of a gap between reasoning phases, and of a tool call with no visible marker. Measured: a recovery write at 12:42:56 reached `ATTENTION` at 12:43:17, twenty-one seconds later, because its supervision was claimable in the same second it was written and read the turn *before* it. Supervision scheduled after a write now waits the same initial delay as a first request, and a completion never observed generating must hold far longer before it is treated as terminal.
- Make plans and executions durable instead of resetting with the session. The session snapshot holds one current plan and one last execution and several lifecycle transitions clear both, so every repair round, workflow round and failed verification was overwritten as soon as the next one started — and the Plans and Executions views, built from that snapshot, appeared to reset on restart. Each plan the AI authors and each execution result, failures and workflow rounds included, is now appended to the persisted event history with its complete body as `plan.recorded` / `execution.recorded`; the views are rebuilt from that ledger with the live snapshot layered on top so a current entry keeps its richer lifecycle label. Because the ledger lives in the event history, it survives restart and travels inside a chat archive package with no second store.
- Redact and bound nested arrays in audit events. Sanitization walked strings, string slices and maps but not `[]any`, which is exactly the shape decoded JSON gives a plan's operations and an execution's per-command stdout/stderr — so those passed through with neither credential redaction nor the length bound applied. Found while routing the new ledger bodies through the same path.
- Stop Worker residency turning into Worker ownership, which had reduced a six-slot pool to one effective worker. A resident slot claims `resident_only`, so the only way it could ever be rebound was by claiming a task from another lane — which `resident_only` forbids. Once every slot had served one conversation each stayed pinned to it for the life of the process, including long after that chat was resolved: with all six resident only the rotation head could escape, and with any slot free not even that one could, because a resident slot may not cross lanes while an unresident slot exists. A resident lane that yields no claimable work for a bounded idle window after its dwell is now released and the slot rejoins the free pool, which is what makes affinity a cache again rather than a lock.
- Stop a blocked Worker monopolising its conversation. Each slot excluded every other slot's resident lane from its own claim unconditionally, so a slot in interaction mode, mid-account-operation or still loading kept the whole pool out of a lane it could not work itself — leaving a due `AWAIT_RESPONSE` on that conversation claimable by nobody at all. A peer only reserves its lane while it is actually able to serve it; the backend's per-conversation write lock and the lease still own conflict safety.
- Stop charging the attempt budget for probes that never attempted anything. Three `AWAIT_RESPONSE` outcomes spent an attempt without reaching ChatGPT: a slot that was not on the expected conversation, an active provider cooldown, and a page in neither a generating nor a completed state. At a 30-second cadence and `max_attempts=30` that retired supervision after ~15 minutes of a conversation Wharnex had simply not looked at properly — all 23 `FAILED` awaits on this instance carry exactly that "exhausted maximum attempts while waiting" signature. Those outcomes are now observations, and the genuinely ambiguous one carries its own evidence-shaped bound instead: a page showing no structural sign of life at all for ten minutes moves to `ATTENTION`, and any generating, completion or download signal resets that window.
- Derive the process-wide navigation gate from the provider's own 429 evidence instead of pinning it at 30 seconds. Navigation is serialized process-wide, so a fixed ceiling let the entire pool rebind twice a minute no matter how many workers were free or how many conversations held due work — six idle workers waiting on one clock is not protection. A healthy provider now uses a six-second floor and each rate-limit level walks the gate back up to the protective 30-second ceiling, which is where a rate-limited account belongs.
- Scroll an account control into view instead of reporting it unreachable. `rect()` refused to measure any control whose centre fell outside the viewport, but the sidebar conversation list and the project picker are both scrollable, so the wanted row is routinely below the fold — 36 of this instance's 77 `ORGANIZE_CHAT` failures are `action-offscreen` against controls that were one scroll away. A control outside the viewport is now scrolled to and re-measured once; scrolling is not activation, the trusted native click still happens in the main process, and a control still outside the viewport afterwards continues to fail closed.
- Converge the browser-agent queue when a chat is deleted. Deleting a chat removed its row and nothing else, so every `AWAIT_RESPONSE`, `TITLE_DISCOVER` and `ORGANIZE_CHAT` queued for it stayed claimable indefinitely: workers kept navigating to abandoned conversations, kept failing account automation against them, and — because the account lane is one global lock — kept live chats' own maintenance waiting behind that dead work. Enqueueing `DELETE_CHAT` now supersedes the chat's other claimable tasks, keeping only the remote cleanup jobs that deletion still has to accomplish. Convergence lives in the store, so the REST path and the Desktop lifecycle bridge reach the same state.
- Hand a passive observation straight back instead of making it pay the provider cooldown. A 2.5-second cooldown after every task spent real pool capacity protecting a request that was never made; it now applies only to work that actually reached ChatGPT.
- Carry the protocol identity on the `harness.utility/v1` request, not only on its result. The Desktop worker validates payload identity fail-closed before it touches the provider, but the encoded request had no `protocol` field at all — so every dispatched `TRANSLATE_MARKDOWN` task failed its first claim with "invalid markdown translation worker protocol payload" while every structural check still passed. Both directions of the wire now carry it, validation rejects a request without it at the producer, and the service test asserts the identity the worker actually checks rather than only the markdown and the language.
- Name bundle completeness in the change protocol, because it is the failure the measured rounds actually hit. Repeated sandbox verifications on this instance failed with `Cannot find module './lib/conflictResolution'` and `undefined: DebugRun` — bundles that patched one half of an implementation and only imagined the other. That shape passes every structural check (valid diff headers, valid JSON, matching request id) and is caught only by the sandbox, after the whole round trip is spent. Every module, symbol, type and config key a patch references must now be resolvable against the manifest or against the bundle's own patch set before attaching, deletions and renames included, and a verification diagnostic already recorded in the attempt ledger is treated as a protocol violation rather than an unlucky round.
- Repair the export metadata gate left behind by the Wharnex rename: the runtime metadata test still asserted `## Wharness status` against headings the code had already renamed, so `go test ./...` failed on a clean checkout.

- Add operator-selectable conflict resolution instead of auto-sending every conflict to GPT. The Plan view now offers **Resolver manualmente** or **Resolver com GPT**; the manual path opens a JetBrains-inspired three-way Monaco workbench with Atual/Resultado/Recebido panes, side acceptance, base inspection, per-file completion and deletion handling. A hybrid path lets the operator resolve any subset and delegate only the remainder: the backend generates the human patch against CURRENT, locks those paths, rejects model writes to them, and combines the human decisions with the GPT bundle before normal validation/execution. Git-origin conflicts use the same UI and can finish as the exact merge the operator started.
- Give every workspace mode the same side rail and the same terminal. The activity rail, its drawer and the interactive terminal were Agent-only and Editor-only respectively; they now live in the workspace shell beside Agent, Editor and Orchestrator alike, so switching mode no longer changes which panel is open or how wide it is. Rendering them once is also what keeps the polling drawers (runtime, Git) from being mounted three times over, which a per-mode copy would have cost. The terminal starts collapsed and is toggled from the rail, because a panel permanently taking height from the chat is a cost the operator should opt into.
- Make the left panel resizable and give every drawer the same starting width. A per-drawer clamp made the workspace jump to a different geometry on each selection; now every drawer opens at one third of the shell, the mode surface takes the remaining two thirds, and in Agent that surface splits evenly again — so drawer, chat and inspector each hold a third of the whole. With the drawer closed the chat keeps 60% of the usable width and the inspector 40%, measured against the space actually available rather than a raw viewport percentage that drifted as the fixed columns grew.
- Stop anything but the operator closing the left panel. Attention routing, following a Worker into the Engine area and switching workspace mode all dismissed it, so a panel being read disappeared underneath whoever was reading it. The drawer now closes only through its own close control or by toggling its rail button — and the project explorer, the one drawer that never had a close control, has one.
- Require a short summary on every plan-bearing response bundle, and show it where it matters. `summary` was in the schema but never enforced, so a bundle could arrive with none; the self-evolution activation dialog then asked the operator to restart the runtime with nothing but a diff to explain what they were activating. It is now validated at ingestion — required, bounded, and rejected when it is a placeholder such as 'short summary', 'changes' or 'done' — at the same seam and for the same reason as `commit_message`, and the activation dialog leads with it.
- Stop workers abandoning a response that was still being written. `AWAIT_RESPONSE` treated one instantaneous structural completion as final, but ChatGPT satisfies every completion condition transiently — between reasoning steps, and in the gap between finishing its text and mounting the file card. A single such sample made Wharnex declare "ChatGPT terminou sem disponibilizar …" over work still in progress and spend a continuation request re-asking for it; every `ATTENTION` on the instance came from this path, at attempts 3, 4, 8, 17 and 28. A completion must now still hold, with the bundle still absent, after a grace measured from the moment the generating indicator actually disappeared.
- Stop a healthy response from exhausting its own supervisor. Every claim increments `attempt`, so the 30-second passive probes shared the failure budget: at `max_attempts=30` supervision died after ~15 minutes of perfectly healthy generation (observed live at 22/30 and 18/30). A lease that only watched a provably still-generating page now reports itself as an observation and the store returns the attempt, leaving the budget to count real attempts. Supervision ends on evidence of trouble, not because a long answer outlived a counter.
- Space autonomous submissions process-wide. Transport preparation is serialized per Worker slot, which bounds one slot but not the pool — six free slots bound to six conversations could submit in the same instant against a single authenticated account, which is the shape that earns a provider-wide 429. Submissions now pass a FIFO 10-second gap and re-check the rate-limit cooldown after waiting their turn, since the cooldown may have opened while they queued. Delivery continuations are likewise spaced, because a continuation is itself a provider request.
- Advance the Worker rotation on every assignment, not only on a rebind. The rotation decides which slot may escalate past its own resident lane, and `settleAssignment` is never reached when a slot serves the lane it is already on — so such a slot stayed permanently at the head, remaining the only Worker allowed to cross lanes while unresident lanes waited behind a slot that never yielded its turn.
- Count only what is in the queue in the Agents drawer. Settled tasks (`DONE`, `FAILED`, `CANCELLED`, `ATTENTION`) have left it, and the lifetime total reported past throughput while saying nothing about what is waiting to run.
- Stop the Agents drawer from reporting an idle scheduler as a large pending backlog. Every delivered bundle enqueues a remote-library cleanup task deferred 72 hours by design, so an instance with three active chats accumulated 38 `DELETE_BUNDLE` rows that no worker could claim for three days — and the drawer counted them as `PENDING` and dated the queue from the oldest of them, presenting 36 pending tasks and a 20-hour-old "oldest task" while not a single task was actually due. Queue depth now separates `due`, `scheduled` and `blocked` using the very predicate the claim query applies, and backlog age is derived only from claimable work: a deferred task is early, not late.
- Compute that queue summary in the session store rather than by counting a listed page. The runtime view listed 500 tasks and counted them in the client, but the list is ordered oldest-first and capped while settled rows were never removed — so once the table outgrew the window it would have filled with completed history and hidden the live queue entirely. A new `GET /api/chat-agent/tasks/summary` aggregates in SQL, exact at any table size, and stops shipping every task payload on each refresh.
- Sweep settled browser-agent task rows on a retention window (`HARNESS_CHAT_AGENT_TASK_RETENTION_HOURS`, default 72h). Terminal rows are bookkeeping, not evidence — durable request history lives in the audit stream — and nothing reads them back, since the active dedupe index, the lineage guard and the child-task lookup all filter to non-terminal statuses. The window stays comfortably longer than any request lifecycle because a completed child task is what stops its parent from enqueuing the same follow-up twice.
- Give a hidden Worker its layout viewport even when it owns the chat the Supervisor is showing. `ensureChatGPTLayoutViewport` identified the visible surface by chat key alone, but being shown is a property of the view, not of the chat: a Worker is hidden even while it owns the selected conversation — the common case, since a chat is organized right after it was used. Such a Worker kept 0x0 bounds, so every `getBoundingClientRect` collapsed to the origin and every located account control was reported `action-offscreen` until `ORGANIZE_CHAT` exhausted all eight attempts, while the control had never actually been unreachable. Only the entry the Supervisor map holds for that key is now exempt.

- Remove the duplicate bundle counter/quota block from the chat header while keeping the recent request/response bundle cards and their full explorer. Rolling quota remains on the workspace/Agent toolbar, and aggregate bundle counts stay in the Files surface.
- Complete the Supervisor/Worker cutover for ChatGPT account lifecycle work: close, rename and delete now enqueue durable worker tasks instead of driving the visible Supervisor, lifecycle completion/error is persisted to workspace remote state, final-attempt WAITING tasks fail terminally, Main Request cancellation cancels its durable lineage, and the Agents drawer exposes scheduler/backend/queue/provider/lease diagnostics with an explicit provider resume control.
- Treat `.wharnex/knowledge/**` as host-authoritative merge state instead of a planner conflict. Request-base snapshots no longer stage volatile managed knowledge into candidate ancestry, preflight filters managed-only collisions, and the real Git merge preserves the exact current host side locally for legacy/existing candidate branches. Mixed conflicts still send only ordinary source paths through `harness.conflict/v1`. This removes the `conflict_resolution_exhausted` rerun dead end without allowing planners to patch managed knowledge.
- Add **Repor alteração** as the inverse of Revert for the latest Protected applied batch. Revert now retains the exact patch batch; Restore replays it atomically, rolls back a partial replay on conflict, and automatically opens a fresh current-context ChatGPT reconciliation request with dedicated `revert_restore` lineage when direct replay is unsafe. Those recovery input bundles receive their own **Pedido · repor reversão** visual category in the bundle explorer instead of blending into generic repair traffic.
- Replace per-chat ChatGPT browser residency with one visible Supervisor, three durable worker browsers, leased chat-agent tasks, and exact retained Library cleanup.

- Strengthen project execution logs: the Execuções drawer now loads a bounded snapshot of the durable backend audit stream for the selected chat, merges live active-chat events, supports execution/session scope and text filtering, and exposes sanitized structured event payloads behind each timeline entry. It falls back to the summarized `ExecutionResult` only when audit history is unavailable, so transport, Policy, repair, verification and host-Apply evidence no longer disappears from the project-wide log view.
- Add two explicit commit modes per project and a dedicated Git surface in the Agent's lateral menu (ADR-0040). **Auto-commit** keeps the integration's commits and stays the default, so nothing changes for an existing project. **Sem auto-commit** runs the same full integration — pre-merge snapshot, real merge, post-merge verification — and then returns the branch to the commit the host was at before Wharnex touched anything, leaving the applied change in the working tree as ordinary uncommitted work. The integration is never skipped: the merge is what reconciles the change with host drift, and skipping it would reintroduce the failure ADR-0035 removed. The reset target is the HEAD captured *before* the pre-merge snapshot, so the operator's own uncommitted edits are not left committed under a Wharnex bookkeeping message.
- Keep the commit message the mode would otherwise throw away. The change protocol obliges every planner to write meaningful Conventional Commits history derived from the actual patch, and that message is the part an operator cannot reconstruct — so each integrated candidate is recorded before the unwind with its message, its declared paths and its own diff, bracketed by the commits immediately before and after *its* merge so unrelated edits fall outside it. Records are written durably before the branch moves and rolled back if any part fails, so a crash leaves recoverable committed history rather than an unexplained dirty worktree with no messages.
- Validate selective committing instead of merely offering it. Committing a path takes its current working-tree content, which already contains every earlier change to that path, so committing a later pending record alone would silently fold an earlier one into it and label the result with the wrong message — history that misattributes work rather than merely being incomplete. Such a selection is refused with the blocking records named. A record whose paths no longer differ from HEAD (the operator handled them in their own terminal) is retired rather than kept as a phantom entry, and discarding a record only ever removes Wharnex's note: the files are never touched.
- Commit from the Git surface as the operator, not as Wharnex. A pending record is committed under their configured Git identity and runs their project hooks — the inverse of every commit Wharnex makes internally (fixed identity, hooks disabled), because that plumbing is Wharnex's while this commit is their own contribution. A repository with no configured identity is reported rather than silently attributed to a bot.
- Add push, with integration instead of failure. A rejected push means the remote holds commits this branch does not, which is an ordinary merge: Wharnex fetches, merges and pushes again. Force-push is deliberately absent — a rejection is a merge, not an overwrite, and offering the flag would make discarding a colleague's commits one click. Pushing requires an explicit confirmation at the API boundary because it is the only action on this surface that reaches outside the operator's machine and cannot be undone by a local reset, and it is never reachable from a model plan.
- Add explicit branch merges and AI-assisted reconciliation for both paths. A conflicting merge is aborted before returning, with its three merge sides recorded: leaving it in place would block every Agent request on the project, since Wharnex's own integration refuses to act on a repository with unresolved paths. The resolution is replayed into that exact merge — merge again, check out *our* clean version of each conflicting path (a file carrying `<<<<<<<` markers is not patchable, while our clean version is exactly the CURRENT the capsule showed), apply the patch, commit. Wharnex never pushes again on its own afterwards: publishing reconciled code stays the operator's call.
- Evolve `harness.conflict/v1` rather than adding a second conflict protocol: the capsule gains `origin` (`integration` | `push` | `branch_merge`) and, for the Git origins, a `git` block naming the merge to replay. The question is identical in both cases — three versions of a file plus the intent behind each side — and only the destination differs. A Git-origin resolution is applied directly to the host merge without Protected verification: its product is one inspectable merge commit the operator explicitly asked for, the planner's authority is already narrowed to the capsule's paths, and reconstructing a half-merged tree in a container to run commands nobody requested would not make it safer. The schema also documents the `intent` block, which had been shipped in code but never written down.
- Show the whole Git situation in one panel: current branch with ahead/behind, local and remote branches, the pending queue with per-record diffs and messages, and the recent history marking which commits originated from Wharnex (by their `Request-Id` trailer, so a change committed manually by the operator is still recognised) and which are still local. Self-evolution always commits — its rollback and activation anchor on real commits — so its toggle is presented as fixed rather than offering a control Apply would ignore.

- Stop a dirty host worktree from blocking host integration, and stop it from blocking every *subsequent* one (ADR-0039). The pre-merge snapshot asked whether `git status --porcelain` was non-empty and then required `git add -A && git commit` to succeed. When a host's only uncommitted state lives inside a submodule, status reports ` M <submodule>` while `add -A` stages nothing — submodule content belongs to another repository — so the commit exited 1 with `no changes added to commit` and Apply aborted before it began. Nothing ever cleaned a submodule worktree (`git reset --hard` does not), so the condition persisted: once a host had a dirty submodule, *every* Apply failed identically until a human fixed it by hand. Preserving uncommitted host work now succeeds when there is nothing a superproject commit can hold, which is a normal outcome rather than an error, and reports what it could not capture so the operator knows it is outside Wharnex's custody.
- Measure the host repository's shape instead of assuming one. A new `internal/hostrepo` resolves the real Git directory, reads the submodule inventory from the index (not `.gitmodules` — the two disagree in both directions), detects an in-progress Git operation from Git's own marker files, and classifies uncommitted state with `--porcelain=v2`, whose per-entry submodule field separates a *moved gitlink* (stageable) from *dirty submodule content* (not stageable) — a distinction porcelain v1 collapses into an indistinguishable ` M <path>`.
- Fix request-base rooting and the merge preflight silently switching themselves off on linked worktrees. Both create a private index at `<root>/.git/…`, but `.git` is a **file** in a linked worktree and in a project root that is itself a submodule, so the call failed with "not a directory" — and since both callers treat capture as best effort, the failure was invisible. It returned those projects to the `patch does not apply cleanly` dead end ADR-0035 exists to remove, and let a merge already known to be doomed reach the host. A preflight that cannot answer is now published as a degradation rather than passed over in silence.
- Stop `git add -A` from converting the operator's untracked nested repository into a bare pointer. An embedded repository (a cloned dependency, a scratch checkout, an unregistered submodule directory) stages as a gitlink, so the snapshot commit that exists to preserve uncommitted work recorded a pointer instead of the files, and the revert built on that snapshot could not restore them. Embedded repositories are now excluded by pathspec from the pre-merge snapshot, the request base and the project baseline, and reported as left in place.
- Refuse, instead of proceeding, on host states where committing damages the operator's own work: unresolved conflict paths and an in-progress merge/rebase/cherry-pick/am (previously their conflict markers were staged and committed into the project's history as though resolved), and an integration that would move the recorded commit of a submodule holding uncommitted work (Git permits that merge and simply leaves the checkout behind — the worst available outcome). Each refusal carries the reason, the paths and the single operator action that clears it, classified `host_working_state_blocked`: the verified candidate is retained, no automatic repair round is consumed, and the UI offers the operator's remedy rather than a GPT repair.
- Disable project commit hooks for Wharnex's own host commits and merges. Any project with a failing `pre-commit` (a lint gate, Husky) blocked every host integration, because neither the snapshot nor the merge disabled hooks — while the sandbox clone already did. Wharnex's host plumbing is its own bookkeeping, not the operator's contribution.
- Realign submodule checkouts after a merge and after a revert. Git updates a gitlink in the index and HEAD and deliberately leaves the submodule's own checkout stale, so post-merge verification built against content matching neither tree — a correct change failing its own gates — and the superproject was left permanently reporting ` M <submodule>`, which is the blocking condition above, now caused by Wharnex itself. Realignment is strictly offline (a commit absent from the submodule's object store is reported as skipped, never fetched) and never touches a submodule holding uncommitted work.
- Reject a patch that writes inside a registered submodule at ingestion rather than at commit time. The sandbox holds the submodule's files on disk but Git cannot see them (the gitlink shadows the directory), so such a plan applied, passed every verification gate, and then died on `fatal: Pathspec … is in submodule` — after the model turn, the container run and the full verification suite had been spent, on a defect no source patch can address. The rejection is now typed as `submodule_write`, stops without spending a fresh ChatGPT recovery request, and directs the operator to open the submodule as its own Wharness project; persisted sessions previously mislabeled `remote_input_transport` are migrated on startup. A conflicting submodule *pointer* is likewise partitioned out of focused conflict resolution, exactly like Wharnex-managed state: it is a commit id, not three versions of a file, so the patch it asks for is rejected on arrival every round.
- Exclude `.git` from context bundles and sandbox copies whether it is a directory or a file. The check was directory-only, so a submodule's and a linked worktree's `.git` — a file holding `gitdir: <absolute host path>` — was copied into sandboxes and into model context, putting a pointer to the host's own repository metadata inside a workspace that must never reach it.

- Stop a hot loop that re-downloaded an already-delivered bundle forever. The DOM poller kept clicking the same download affordance while the request stayed armed: each click genuinely re-downloaded the ZIP, the will-download handler recognised it as a duplicate and dropped it, `downloadInFlight` cleared on `done`, and the next sweep clicked again — ten full cycles in one recorded log window, burning CPU and network on a conflict surface without ever progressing. The poller now checks whether the request was already delivered before clicking and releases the expectation, since supervision for it is finished.
- Stop reporting an inconsistent chat association on every chat switch. The guard compared `session.chat_id` against `activeChatId`, but the switch now changes the active chat immediately and reconciles the session behind it, so `session` is briefly still the previous chat's — an expected transient that the guard read as a real inconsistency and surfaced as `Associação de chat inconsistente…`. It now only judges a session that is actually the one the active chat points at; a genuine mismatch is still reported, and the legacy chat-id backfill is unchanged.
- Pace and bound frontend renderer crash recovery. The handler reloaded the instant the process died, but a loadURL issued while a previous sandboxed renderer spawn is still settling is one of the ways Electron produces `Cannot destructure property 'preloadScripts' of 'binding.startupData'` — so an immediate retry can turn a single crash into a reload loop, which is what the repeated page reloads looked like. Recovery now backs off (500 ms doubling to 8 s) and stops after five restarts rather than thrashing, leaving a window that will not come back for human attention; a renderer that stays up 30 seconds clears the budget.
- Close the managed-state conflict contradiction on the second integration path. The Git-native merge path was fixed, but the legacy ChangeSet compare-and-swap path still handed `.wharnex/knowledge/*` conflicts to a planner, so the same unsatisfiable request came back as `verified changes require focused conflict resolution: .wharnex/knowledge/brand-identity-system.md, .wharnex/knowledge/catalog.json`. Both paths now partition managed state out, with a test asserting neither can drift. A conflict confined to managed state is also reported as its own terminal condition (`ErrManagedStateConflict`) instead of as a resolvable integration conflict, so it no longer offers a resolution path that cannot exist and no longer triggers an apply-failure repair round the model could never satisfy.
- Fix the reasoning capture anchoring on an element that does not exist while the model is working. It looked for the newest `[data-message-author-role="assistant"]`, but during generation that count is 0 (measured against the live session) — the steps stream into the newest `[data-turn-id]` before any assistant message exists, so the capture found nothing for the entire period the reasoning is actually interesting and the panel could only show its placeholder. Anchored on the newest conversation turn instead, and verified live: the probe now returns the same step ChatGPT was displaying.
- Stop rejecting a verified bundle because its forecast mentioned Wharnex-managed knowledge. `impact_files` and `read_files` are declarations, not mutations, but both were validated with the patch-path rule, so a plan whose forecast named `.wharnex/knowledge/*` failed with `impact_files 0: sensitive patch path denied` — while Wharnex itself materializes that subtree at the commit boundary, making the forecast correct. Declared paths now carry the structural rules plus the secret-like denial (declaring a read of `.env` or `.ssh/` is still refused on its own), with Wharnex-managed knowledge as the single carve-out. Patching that subtree stays denied, which is where a write is actually decided.
- Make the chat switch instant. Selecting a chat raised the global busy flag and then awaited a backend round trip plus up to three mode PATCHes *before* changing the active chat id, so clicking a tab did nothing visible until the network answered — and only then did the panel remount, the old surface hide and the new one show. Everything the user perceives on a switch is local (active tab, transcript, composer draft), so the switch now lands immediately from localStorage and the session is reconciled behind it, served from a per-chat cache when known. A restored session is discarded if the user has already switched away, and only the switching chat's own busy flag is raised, never the global one that disables the tabs themselves.
- Cap resident ChatGPT surfaces per window (4) with conservative LRU eviction. A view was created lazily per chat and never released while that chat stayed open, so a long session that visited many chats accumulated one sandboxed Chromium renderer per chat on the shared partition — the resident cost behind switching feeling progressively heavier. Eviction never takes the active view, and never one Wharness still owns a reason to observe (expected bundle, pending human action, in-flight transport or account operation), so background bundle supervision is unaffected. The pooled agent slots remove this structurally (ADR-0038); this is the interim bound.
- Populate "Raciocínio visível do ChatGPT" with the reasoning ChatGPT is actually showing. The panel, its item type and its whole IPC path already existed, but the DOM probe that feeds them returned an empty string unconditionally, so the card could only ever render its placeholder. The probe now extracts the live reasoning steps structurally — short leaf lines that neither sit inside nor contain a code, markdown or screen-reader-only region — discarding wrapper elements that report the concatenation of the rows beneath them. It stays passive: a collapsed "Processou durante …" disclosure is not expanded, because a health probe must never click. AGENTS.md section 8 is amended in the same change to authorize this bounded exception, and the DOM-script test now asserts the exception's boundary rather than a blanket ban on reading text.
- Stop a background chat surface from covering the window for a frame when it is activated. Account automation gives a parked surface a real full-size layout viewport so its renderer lays out and accepts trusted input — Electron clips a child view to its parent, so off-screen bounds collapse it to 0x0 and it stops receiving input entirely (measured, not assumed). Those layout-only bounds sit at the origin, so a view activated before the renderer reported its real pane geometry briefly covered the entire Wharnex UI, which reads as the project closing and reopening. Such a view is now marked parked and cannot be shown until real pane bounds arrive.
- Break the infinite conflict-resolution loop on Wharnex-managed project state. A merge conflict on `.wharnex/knowledge/catalog.json` routed into focused `harness.conflict/v1` resolution, which requires the returned bundle to patch exactly the conflicting path — but the patch validator refuses every `.wharnex/knowledge/*` path as sensitive before conflict-specific validation runs. No valid bundle could exist, so the request failed at ingestion and every retry reproduced it identically (observed six times against one request). Both rules were individually right and jointly contradictory. Managed paths are now partitioned out of focused resolution: a conflict is handed to a planner only for paths it is actually allowed to patch, and a conflict confined entirely to managed state ends in an actionable local state instead of another model round. `protocol.IsWharnexManagedPath` is the single rule both the validator and the router consult, with a test asserting they cannot drift apart.
- Stop background chat maintenance from resurrecting ChatGPT surfaces. The naming job called into chats whose renderer had been released, and each call created a fresh Chromium renderer plus a navigation on the shared authenticated partition — measurably heavier chat switching, which is the resident cost the agent pool exists to remove. The job is now opportunistic: it acts only on chats whose surface is already live, and a view created for a deferred remote-archive retry is released again whatever the outcome. Account automation also no longer resizes a view the window is currently showing.
- Fix conversation affinity breaking the moment a conversation is filed under a ChatGPT project. `chatGPTConversationID` matched only a root `/c/<id>` path, but a conversation inside a project is served from `/g/g-p-<project>/c/<id>`, so it returned nothing: the chat's durable binding was lost and account operations could no longer address the conversation by id, surfacing as `A conversa continua vinculada, mas a organização remota requer atenção (menu-unavailable)`. This was latent until the account automation's project move actually started working.
- Introduce pooled chat agents with one global priority queue and JSON behavior documents (ADR-0038, core landed). A small pool of ChatGPT instances is rotated across chats instead of one view per chat: one chat holds the pool at one slot, two or more raise the floor to two so the slot the user is watching is never the slot doing background work, and the pool grows to a ceiling (default 3) but never past the chat count. Exactly one slot carries the `view` role and follows the active chat; a background read may never take it. All agents pull from a single queue where writes outrank account operations which outrank reads, and dispatch is non-preemptive — a running job finishes rather than leaving a surface with a menu open or a navigation mid-flight. Selectors, labels, timings and verification budgets move out of control flow into a validated `harness.chat-agent-behavior/v1` document, so a UI change or a second provider is a document rather than a code change; a learned overlay may only extend selector lists, never remove a builtin.
- Capture ChatGPT's visible reasoning for the "Raciocínio visível do ChatGPT" panel. Completed reasoning collapses behind a disclosure ("Processou durante 5m 23s"), which is why a retroactive scrape found nothing before it was mapped; the agent expands it and extracts the summary rows structurally — short prose lines that neither sit inside nor contain a code or markdown region — so "Validou estilos e temas da interface" is kept and the tool/code block beside it is not. Wrapper elements report the concatenation of the rows beneath them and are discarded by containment. Verified against the live DOM.
- Map the composer's model and reasoning-effort controls, which ChatGPT exposes behind a single unlabelled composer pill: reasoning effort is an arrow-key slider (Instantâneo → Médio → Elevada) and models are `menuitemradio` entries. Options are matched by role and aria state rather than by the build-hashed class names in that menu. Wharnex effort and provider reasoning effort stay separate settings and are not conflated.
- Fix ChatGPT account automation against the real ChatGPT DOM, and stop a remote failure from holding a local action hostage (ADR-0037). Three defects were confirmed by driving the operator's own authenticated session rather than inferred from logs. ChatGPT renders its conversation menu as Radix `div[role="menuitem"]` nodes that ignore a synthetic `HTMLElement.click()`, so every rename, move and archive opened the menu and then exhausted its retries on the item — the `action-unavailable` users saw. Rename waited for a `[role="dialog"]` that ChatGPT never renders; it renames through an inline sidebar `input[name="title-editor"]`. Project lookup required `a[href*="/g/g-p-"][data-testid*="project"]`, but those anchors carry no `data-testid`, so existence always reported `missing` and every request created the project again — the observed remote duplication. Account scripts now locate their control and return its click rect, which the main process commits with trusted `sendInputEvent`; menus are addressed by `data-conversation-options-trigger` (the conversation's own id) rather than list position; project existence is decided by reading the account's own "Move to project" inventory with case and whitespace folded, and creation is confirmed by re-reading it, reporting a multi-match as a duplicate instead of accepting it. The permitted inspection boundary is unchanged: structural control metadata and exact user-owned labels only.
- Never block closing a chat on an unconfirmed remote archive. `A conversa local não foi arquivada porque o arquivo remoto não pôde ser confirmado (action-unavailable)` aborted the local archive over a remote surface Wharnex does not control — and, because of the defect above, that remote archive could never succeed, so the chat could not be closed at all. The local archive is authoritative and always proceeds; an unconfirmed remote archive becomes durable `remoteArchive` state that a background job retries under bounded exponential backoff (5 min doubling to a 6 h ceiling, 8 attempts), recreating the released view from the stored conversation URL so a torn-down renderer is never mistaken for a completed archive.
- Add background chat maintenance: one job assigns a definitive title and moves the conversation into its project for chats still carrying the provisional title derived from their first prompt, and the retry job above finishes deferred remote archives. Jobs process one item per tick, skip the chat the user is viewing, never overwrite a title the user typed, and degrade into durable state instead of raising an error over unrelated work.
- Add global language preferences and non-destructive Markdown translation (ADR-0036): Configurações now supports Portuguese/English/French interface locale selection plus one-or-more translation targets, and every session-owned Markdown file/document viewer can translate through a dedicated `harness.utility/v1` GPT utility engine without modifying the source. The utility port is deliberately separate from planner/execution capabilities and returns strict structured Markdown only.
- Make the commit-history contract real instead of advisory. The rules for a good `commit_message` were published in the prompt and the SoT but nothing enforced them, and two structural defects made a good message impossible anyway: the sanitizer collapsed every newline into a space, so a commit *body* could never survive — every Wharness commit was a bare subject regardless of what the planner wrote — and the empty-message fallback emitted `chore: Wharness-verified change`, the exact string the protocol names as a quality failure. `commit_message` is now a full Git message (subject, blank line, body preserved verbatim), and a `change` bundle is rejected when it is missing, is not Conventional Commits with an accepted type, exceeds the 72-character subject limit, omits the blank separator, or matches the closed set of bookkeeping subjects. Validation runs at ingestion, before Policy and sandbox verification, so a weak message costs one re-request rather than discarding a verified candidate over prose. The planner prompt now states the required shape, explains that the body must answer *why* rather than restate the diff, and carries a worked example.
- Root every verified candidate at the tree its patch was actually written against (ADR-0035), removing the recurring `patch does not apply cleanly` dead end. `copyProject` clones the host's real history but then overlaid the host's *current* files, so a plan whose context was snapshotted before any peer chat, human edit or external agent touched the same file could no longer be applied at all — and the overlay left the sandbox index inconsistent with its worktree, which is what disabled the `--3way` fallback (`does not match index`). This was never a concurrency bug: it reproduces perfectly with the queue at its default capacity of one, because the collision is with work that has *already merged*. Each request now anchors its exact host tree as a real commit under `refs/wharnex/base/<request_id>` — staged through a private temporary index, so the host's index, HEAD, branch and working tree are untouched and an operator's half-staged work is unaffected — and the integration branch is rooted there. The patch applies by construction, the candidate's commit descends from its own base, and real divergence becomes an ordinary three-way merge that Git resolves with no model turn whenever the changes are compatible. Capture and rooting degrade to the previous behavior rather than ever failing a request.
- Decide collisions with a real merge instead of an overlap heuristic. Whether two changes can be combined is answered by `git merge-tree --write-tree` — Git's own machinery, offline, touching no working tree, index or ref — not by impact-file, line-range or column overlap, which is wrong in both directions (identical edits to the same range merge cleanly; disjoint ranges still conflict across a rename, a delete/edit pair, or context drift). Apply preflights against the host's real current content including uncommitted state, because the real merge commits that state first; a doomed merge therefore no longer reaches the host at all and no longer leaves a `Wharness host snapshot before integration` commit behind for a merge that never happened. An older Git that cannot answer degrades to "unknown", never "clean"; the atomic merge stays authoritative.
- Give conflict resolution the intent of both sides. A `harness.conflict/v1` capsule carried BASE/CURRENT/RESULT text but nothing about *why* either change exists, leaving a resolver to infer purpose from the diff — which is where a textual fix that silently drops the other side's behavior comes from. The capsule now carries the candidate's own planner-authored goal and commit message, the Conventional Commits subjects of the already-integrated changes it collides with (making that long-required field load bearing rather than cosmetic), and the attempt number, its bound, and what earlier rounds of the same conflict already tried, so a resolver can see it is circling rather than converging.
- Stop a persistent integration race from being an endless retry. `host changed repeatedly during ChangeSet integration: external write race on <path>` was classified as retryable host concurrency, which offered a retry whose only possible outcome was the identical failure and no path to planner resolution. Retrying stays correct for the first attempts, but a path that races through every restage means the candidate and the host have genuinely diverged there and Apply is non-convergent. It now escalates to the same bounded focused-resolution path a detected conflict uses, scoped to the racing paths, with the host's current content as CURRENT. The racing path travels as a typed error rather than a message, and an unattributable race keeps its previous classification instead of becoming a conflict with nothing to resolve against.
- Make per-project execution concurrency adjustable at runtime and visible beside the FIFO queue it governs (`WHARNESS_PROJECT_EXECUTION_CONCURRENCY` still sets the startup value). Lowering it never interrupts running work — the project admits nothing new until it drains under the new limit — and raising it admits plans that are *already* waiting, not only later submissions. The ceiling stays small because each concurrent runner claims a full container memory allowance plus a complete project clone.
- Make Agent plan approval a first-class linked continuation (ADR-0034): `harness.turn/v1` adds the non-mutating `plan` proposal kind, explicit requests to elaborate a plan now produce an approval card even in Direct mode, and **Aprovar plano** calls a dedicated backend endpoint that creates a fresh `plan_approval` child request under the same Main Request/root lineage instead of posting another standard user request. Rejection is also explicit, and approval transport failures no longer reopen an already-created approval and risk duplicate continuations.
- Complete the non-blocking ChatGPT bundle-quota UX: the global 3-hour sent/received estimate is now visible in `WorkspaceTopbar` even before the active chat has exchanged a bundle and, crucially, as a persistent GPT-style consumption meter in the Agent command bar for the embedded multi-project layout where `WorkspaceTopbar` is absent. The meter shows delivered request bundles against the configured limit, received response bundles, and a thin pressure bar; it refreshes immediately when active-session artifact metadata changes with a 60-second fallback and remains a local Wharnex estimate with warning-only, never-blocking behavior. Add boundary regressions for the inclusive rolling window, over-limit sends, received-only traffic, topbar accessibility, and Agent-meter visibility.
- Rename the `legacy` release runtime identity to `statable`: the `WHARNESS_INSTANCE_ID` sentinel that blocks a deployed release from self-evolving (`SoT/EXECUTION_MODEL.md`) now reads `statable`, and `legacySelfOpenForbidden` is renamed `statableSelfOpenForbidden` to match. This is a rename of this environment's own identity label only — it does not touch the unrelated "legacy data format" compatibility paths (pre-v2 knowledge protocol, pre-Compose PostgreSQL migration, old ChangeSet integration path) documented elsewhere, which keep their existing terminology and persisted values unchanged.
- Disclose the real local execution environment to the planner and stop spending requests on infrastructure faults (ADR-0033). An audit of ~3 400 persisted failure rows showed most lost requests were never model defects. Every planner prompt now carries a Wharness-measured `wharness.environment/v1` manifest — host OS/kernel/arch/CPU, total and available RAM, free space on both the project and sandbox-scratch filesystems, the container's real memory/CPU/pids/tmpfs limits and cache environment, the runner image's own executable inventory with versions (the image self-describes through a `kernl-toolchain` entrypoint, so the Dockerfile stays the single source), the policy engine's own denied/elevated/git decision sets, and the protocol validator's own numeric budgets. Policy and budget values are read from the engine and validator rather than restated, so the published contract cannot drift from the enforced one; measurement is best-effort and time-bounded, degrading to a warning instead of ever delaying a request.
- Fix the sandbox running out of scratch space mid-verification. `GOCACHE` moves off the size-capped `/tmp` tmpfs onto the workspace volume beside `GOMODCACHE`, so a race build is bounded by host disk — this was the concrete cause of `link: mapping output file failed: no space left on device` failing a real request and then burning repair rounds that could never succeed. Default runner limits rise to 4g memory / 512 pids / 1g tmpfs, each overridable via `WHARNESS_RUNNER_MEMORY`/`_CPUS`/`_PIDS`/`_TMPFS`.
- Expand the runner toolchain with the non-privileged utilities real plans asked for and did not find: `jq`, `ripgrep`, `patch`, `diffutils`, `unzip`, `zip`, `xz-utils`, `file`, `tree`, `pkg-config`. Network clients stay absent by design. Requires `make build-runner`.
- Classify `sandbox_resource_exhausted` (disk/memory/descriptor exhaustion, detected from real command output) and `artifact_storage_full` (object store out of space) as infrastructure failures that never consume an automatic ChatGPT repair round, joining `offline_go_module_cache`. A missing executable stays repairable but the repair prompt now names it as the root cause instead of handing over raw output that invites re-reading unrelated source.
- Stop auxiliary payloads from destroying verified work. Archiving the response bundle and staging its knowledge candidate are bookkeeping performed alongside a verified result: their failure now records a structured degradation event (`artifact.persist_degraded`, `knowledge.stage_skipped`) and ingestion continues. A knowledge candidate whose `base_revision` a peer chat superseded is refused as a distinguishable concurrency outcome (`concurrent_catalog_revision`), never as a protocol defect — previously a full MinIO volume or a parallel-chat catalog bump discarded a complete, verified change.
- Normalize command budgets instead of rejecting the bundle. A `timeout_seconds` that is missing, zero, negative or above the ceiling is repaired to the documented default or clamped, with `plan.budgets_normalized` naming each adjustment; the accepted range now travels to the planner in the environment manifest. Two consecutive requests in one session had been lost, patch included, to a single out-of-range value. The validator's error also states the accepted range.
- Fix `fatal: refusing to merge unrelated histories` stranding a session in an unrecoverable repair loop. A verification sandbox rebuilt from an immutable archived request base has a synthetic root commit and shares no ancestor with the host, so merging a pending candidate's integration branch into it is impossible by construction. Such a candidate is now replayed as the diff of its own verified commit (still in the host's object database), downgrading to the plan's recorded patches with `integration.branch_replay_downgraded` if the host no longer holds it. The merge path is unchanged wherever real shared ancestry exists.
- Stop discarding a downloaded bundle that belongs to another chat. A structurally valid `whx_bundle_res_*` naming a request the downloading surface does not currently expect is no longer cancelled as a transport error — the normal shape of running several chats at once. Its bytes are retained and published with no owning cacheKey so the existing workspace-wide router delivers them to whichever chat owns that request, and the spurious failure it used to raise against the unrelated newer request is gone.
- Narrow host-facing serialization to the host-facing write: pushing a verified integration branch into the host's `.git` is the only host mutation in the verification phase and is now taken under the project apply lock directly. Per-project execution concurrency becomes an operator knob (`WHARNESS_PROJECT_EXECUTION_CONCURRENCY`, default 1, max 8), because each additional concurrent runner claims a full container memory allowance and a complete project clone.
- Fix the workspace crashing with `Cannot read properties of null (reading 'filter')` on any project with no orchestrator plans yet: Go marshalled the empty plan/task/run/dependency collections as `null` while the overview views call `.filter` on them directly. The backend now always emits `[]`, and the API client normalizes the overview so no backend version can take down the render.

- Add the **Orchestrator** workspace mode (ADR-0032): a project objective is decomposed through the dedicated `harness.orchestrator-plan/v1` planner contract into a durable PostgreSQL Plan/Task dependency DAG, explicitly approved, then supervised from Overview or Kanban/Table/List/Graph task views. Readiness and transitions are backend-authoritative, manual planner JSON import remains supported, and V1 keeps one mutation slot per project by starting every READY task through the existing Agent/Policy/Protected/Apply pipeline rather than creating an AI-to-shell shortcut.
- Replace the single-document/final-round project knowledge protocol with `harness.knowledge/v2`: chats get a composer sharing toggle (on by default and force-refreshed after parallel-chat catalog updates), request transports attach independently versioned `knowledge/<id>.md` records, every planner response carries cumulative `summary.md` plus a staged catalog candidate, and Wharnex commits each retained item both as a shareable `.wharnex/knowledge/<id>.md` project file and as a separate DB row only at the real Main Request terminal boundary. Project-file knowledge pulled or edited by another developer is imported before planning, while the managed subtree is excluded from ordinary context/patch paths. New requests no longer schedule an extra `knowledge_review`; legacy pending reviews remain ingestible for upgrade compatibility.
- Fix durable ChatGPT request resumption after a Desktop restart losing the full original repair prompt from the continuation state. Rehydrated continuations now preserve the request-scoped project-knowledge identity/content required by the input-bundle validator; a preparation failure escalates once to explicit human attention instead of retrying silently every polling cycle.
- Add a passive chat archive/compaction lifecycle (ADR-0031): closing a chat now instantly archives its backend session with no other work, and restoring it shortly after is just as instant. A throttled sweep, running strictly one session at a time, folds any chat left archived past a 72h grace period — its MinIO artifacts, audit/log events and on-disk context archives — into one zstd-compressed package and deletes the originals only once that upload is confirmed; restoring a compacted chat then extracts the package back into place. The chat transcript itself remains a frontend-local concern, unaffected by this pipeline.
- Fix terminal planner-failure notices exposing the same-request `Reenviar request` action after Desktop has correctly retired that delivered prompt. Failed/partial bundles now keep only the fresh-request `Retomar pedido` recovery path, while `Reenviar request` remains limited to outbound/prepared/submitted delivery phases where the Desktop retry cache is valid.
- Fix `submitChatGPTDraft`'s retry loop (`submitWithRetry`) always throwing `TypeError: beforeAttempt is not a function` on every automatic ChatGPT submission, because the retry helper had no default for that parameter and its sole caller never passed one — a regression from the submit-retry refactor. This silently discarded whichever prompt was sitting unsent in the composer (observed with an automatic repair/correction prompt carrying a verification failure), because the expected-bundle wait had already been armed before the submit attempt; the DOM poller then treated the stale, already-settled prior turn as "finished without a bundle" and overwrote the unsent draft with a generic content-free `WHARNESS DELIVERY CONTINUATION` nudge instead of surfacing the real send failure. `submitWithRetry` now defaults `beforeAttempt` to a no-op like its `pasteWithUploadRetry` sibling, `submitChatGPTDraft` re-verifies composer readiness between retries, and every caller that arms an expected bundle immediately before submitting now disarms it if that submit itself throws.
- Fix ChatGPT input transport regressing to clipboard-based file paste, which lost the canonical attachment filename (observed: a random-looking name instead of the real one) and could duplicate attachment state across upload retries — restore injection through ChatGPT's dedicated file input via CDP `DOM.setFileInputFiles` (`selectChatGPTUploadFile`), which this codebase had already fixed once (`fix: preserve ChatGPT request bundle filename`) before a failed self-evolution rollback silently reverted the working-tree files back to the clipboard-paste version without leaving a record. Also fix a task comment with attachments pasting one raw file per attachment instead of bundling them into a single ZIP like every other request transport; both now go through the same single-file, real-filename path.
- Send the project's accumulated incremental knowledge document with every planner request for that project — the first request of a chat, every automatic repair round, every workflow-continuation round, both conflict-resolution rounds, and the closing `knowledge_review` round — instead of only the first request of a new chat; repair/workflow/conflict rounds previously received it in no case, regardless of chat position. Reframe the document's purpose toward operational/procedural knowledge (what made a change fail to apply, need repair, or hit a conflict, and how to avoid that) rather than normative rules, which already reach the model through the project's own `AGENTS.md`/`SoT`/ADR files on every request.
- Self-heal the self-evolution durable batch lock when it is stuck fail-closed (e.g. `rollback_failed`) behind a transaction directory that no longer exists on disk: since only the manager's own `Finalize` can ever remove that directory, its absence always means the record is orphaned rather than genuinely in flight, so `Prepare` now reclaims the lock automatically and logs the reclaim to `.harness/logs/self-evolution.log`. A transaction whose directory is still present keeps blocking exactly as before. Fixes a permanent `self_evolution_transaction_busy` deadlock that no ChatGPT-side patch could ever resolve.
- Recover a retained self-evolution transaction after the Wharness checkout itself is renamed or moved: when `transaction.json` still names the now-missing former absolute root, `Prepare` may rewrite it to the active root only if the active root is itself the Git repository top-level, the transaction captured a Git baseline that is still an ancestor of that checkout, and all existing transaction-id/member/artifact proofs also pass. Existing alternate roots and non-Git/uncorrelated moves remain fail-closed.
- Add an Agent-mode left-rail **Conhecimento do projeto** explorer backed by the persisted per-project knowledge source, with searchable Markdown topics, version/update provenance, refresh, and an empty state before the first retained learning.
- Replace the CAS/ChangeSet host integration mechanism with a Git-native protocol: a verified sandbox candidate is committed onto its own `whx/<request_id>` branch (author `Wharness <wharness@localhost>`, message = the plan's now-mandatory `commit_message` plus `Request-Id`/`Plan-Id` trailers) and pushed locally into the host's own `.git`; Apply performs a real `git merge --no-ff --no-edit` on the host, reruns the plan's verification commands post-merge, reverts with `git reset --hard` on failure, and deletes the branch on success. A real merge conflict routes into the existing `harness.conflict/v1` capsule, now sourced from `git show` against the merge-base/host/branch commits. Candidates reconciled from an immutable archived base (no shared Git ancestry with the live host) keep using the legacy `ChangeSet` path unchanged. Structurally resolves the `stale_pending_baseline` dead-end: an obsolete pending candidate is now an ordinary merge conflict instead of a recovery-less impasse.
- Add incremental per-project knowledge: after a verified change is applied to the host, WHX sends one optional final `knowledge_review` round carrying that task's full history and the project's current knowledge document, asking whether anything is worth retaining; the planner's mandatory summary (files changed, next steps, knowledge captured) surfaces as an ordinary chat message, and an optional `knowledge.md` full-document replacement is delivered on the first request of each new chat on that project. Never mutates session state.
- Fix the v1.2.46 legacy ping-pong classifier so persisted `host changed repeatedly during ChangeSet integration` errors are matched case-insensitively after normalization and are recovered from either `LastRepairError` or legacy `LastExecution.Error`, preventing a renderer/backend reload from misclassifying a host integration race as a model defect.
- Harden concurrent Protected Apply against the ping-pong modes captured by chat audit `64623e2c-6674-4d07-a593-2f48491cec96`: verification-only plans no longer poison the host candidate, race restaging accepts unchanged host-baseline verification failures, abandoned self-evolution transactions release their locks without rolling back external writes, and stale/busy/repeated-CAS conditions and request-context cancellations surfaced as exit -1 are classified as local coordination/lifecycle failures that never consume GPT repair/retry rounds. Automatic repair/conflict/workflow dispatch also consults durable transcript request ids to prevent re-sending the same request after a renderer reload. Move chat audit export from the Agent activity rail into a fixed active-chat header with a compact **Exportar ZIP** action.
- Add a fail-closed **Exportar chat** audit ZIP for the active Harness chat. The archive groups exact persisted main/correction request and response bundles, backend/frontend event history, execution command logs and exit/success/error fields, Policy/approval/block events, request lineage, session snapshots and GPT transcript responses correlated to request ids where available.
- Route conflicts discovered while replaying a retained Protected ChangeSet into the dedicated `harness.conflict/v1` resolution path instead of starting an impossible generic repair loop.
- Persist Main Request lineage and classify iterations as standard, repair, evidence extraction, or conflict resolution; group the Execution timeline by that lineage.
- Timestamp WHX transcript notices, link them to their triggering request, and add separate **Retomar pedido** and **Cancelar pedido** actions. Cancellation releases the conversation while preserving verified Protected candidates.
- Make the local-evidence `workflow` contract explicit: ChatGPT may return a command-only bundle describing the missing information, and WHX returns its bounded local observations to the same Main Request.
- Persist bounded/redacted operational events in PostgreSQL and expose an evidence explorer plus guarded AI plan analysis only when WHX has opened its exact canonical runtime root.
- Recover one time automatically from strict bundle-validation failures and retryable terminal planner outcomes using a fresh request id, current immutable base and owning ChatGPT surface; older retry controls stay disabled while the replacement is active.
- Restore a visible `WHX · AUTO-EVOLUÇÃO` badge in both standalone and embedded project layouts.
- Renamed the visible product identity to Wharnex with code name WHX while retaining `wharness-*` protocol and runtime identifiers for compatibility.
- Added a typed API-first ChatGPT account provider with a bounded browser fallback for project creation/reuse, conversation move/rename/archive/stop and sidebar collapse; private session cookies and undocumented endpoints remain forbidden.

- Rehydrate every pending ChatGPT bundle supervisor on startup, keep inactive chat views alive and hidden, and route downloaded bundles through the workspace controller so Auto import/execution no longer depends on the selected Inspector pane; historical turns remain recovery-ineligible until a fresh baseline and stabilization grace are established.
- Make bundle polling single-flight per chat and parallel across chats; distinguish structural processing/error/terminal states, bound automatic continuation to one request-scoped attempt, and add a guarded manual `Retomar pedido` fallback.
- Serialize all Agent executions through a cancellation-safe FIFO queue per project while preserving parallel planning and execution across different projects.
- Persist execution intentions across backend/frontend/Desktop interruption and present a startup recovery modal that requires an explicit Continue or Discard decision.
- Project the backend's per-project FIFO in the frontend with chat, plan, position and waiting/running state, including queue lifecycle events in execution history.
- Treat ChatGPT stream-resume failures as language-neutral transport faults eligible for bounded reload, while ambiguous silence can only escalate to the user and can no longer inject an automatic `WHARNESS PROCESSING RECOVERY` prompt.
- Hydrate exact cached Go modules and authenticated download metadata into each private Protected sandbox with `GOPROXY=off`; missing modules now fail as infrastructure prerequisites and no longer generate misleading ChangeSet-repair turns.
- Recreate terminal protocol-failure retries in the backend with a fresh request id, current context and immutable base instead of reconstructing them from local transcript items; surface the exact 409 domain reason when retry is unavailable.
- Add explicit restore-linked-conversation and send-time rebind authorization controls; archiving now releases local remote-view supervision.
- Replace proactive global-baseline supersession with immutable request bases and canonical verified ChangeSets, allowing independent concurrent work to continue across edits from other chats, humans, Codex, or Claude.
- Three-way merge BASE/CURRENT/RESULT in a fresh integration sandbox, rerun verification, and protect host commit/rollback with per-file compare-and-swap and bounded race restaging.
- Add `read_files`/`barrier_files`, a bounded revision journal, a visible integration queue, and the focused `harness.conflict/v1` protocol.
- Give every real conflict its own persisted ChatGPT `WebContentsView`/conversation affinity, separate from the main Harness chat, with explicit cancellation and strict conflict-path validation.
- Allow safe documentation templates such as `.env.example` while continuing to deny real secret-like environment paths.
- Recover missing disposable context ZIP/text artifacts on demand after restart, and automatically resume a persisted legacy baseline prompt instead of leaving ChatGPT prompt preparation in an HTTP 404 loop.
- Reconcile pre-v1.3 patch-only requests once against a fresh Protected sandbox when their immutable request archive is unavailable; never create another baseline-supersession ping-pong.
- Require an exact Git top-level match when preparing sandbox copies, preventing immutable bases under `.harness/bridge/tmp` from being mistaken for the ancestor Wharness repository; a successful retained-plan retry also retires its obsolete automatic-repair request.
- Hydrate missing safe verification dependencies into partial immutable context bases without overwriting archived patch/read/barrier files; if an authoritative path is absent, conservatively verify the patch on the current full Protected sandbox instead of executing an incomplete project tree.
- Keep the original project as the dependency-hydration source for restored historical sandboxes, so excluded `node_modules` is copied lazily from the host project rather than incorrectly searched inside the partial request archive.
- Start a newly-created dedicated conflict ChatGPT surface from the new-chat route instead of inheriting the main chat's conversation URL; only an already-persisted conflict affinity may be reused.
- Correlate a failed strict bundle download to the request id encoded in its own filename before consulting the surface's newer expectation, preventing a late repair bundle from terminating an active focused-conflict request.
- Restore a persisted focused-conflict prompt on backend startup when a previous transport failure cleared its pending marker, preserving the verified ChangeSet instead of stranding the session as failed.

## v1.2.43.2.5 - Retain patches in export (rebased)

- Rebase the patch-retention export change onto the exact post-v1.2.43.2.3/2.2 checkout exported at 2026-09-05 18:59, avoiding the stale `scripts/export.sh` hunk that prevented v1.2.43.2.4 from applying.
- Keep repository `patches/` content in `make export` as useful distribution/debugging context while continuing to exclude `.harness`, `.idea`, `.orig/.rej`, generated `kernl-context-*`, `wharness-input-*`, `wharness-bundle-*`, caches, builds and secret-like material.
- Make `export-check` require every top-level `patches/*.patch` present in the repository to also exist in the archive, and report the retained patch-file count in the normal `make export` log.

## v1.2.43.2.3 - Clean export patches exclusion hotfix

- Fix the clean exporter so the documented `patches/` exclusion is actually passed to `zip`; previous v1.2.43.2.x exports could still include the historical patch archive even though `EXPORT_INDEX.md` claimed it was omitted.
- Make `make export` itself fail closed when any forbidden runtime/generated entry survives filtering, printing up to 20 offending paths instead of relying only on the later `export-check` gate.
- Preserve the v1.2.43.2.1 EOF-consuming pipeline behavior, size/entry/SHA-256 logging and the v1.2.43.2.2 deterministic project-explorer test.

## v1.2.43.2.2 - Project explorer async test stabilization

- Fix the AgentWorkspace project-explorer regression to wait for the asynchronously loaded `README.md` tree item itself instead of waiting on the always-present refresh control.
- Remove a timing race that could fail `make check` under CPU/IO load even though `api.listFiles()` and the production explorer were behaving correctly.
- Keep the v1.2.43.2 embedded-auth behavior and the v1.2.43.2.1 clean-export SIGPIPE fix unchanged.

## v1.2.43.2.1 - Clean export SIGPIPE hotfix

- Fix `make export` under `set -o pipefail`: the largest-files inventory no longer uses `head`, so upstream `sort` cannot be terminated by `SIGPIPE` and return exit 141 after an otherwise valid archive was built.
- Make `export-check` consume `unzip` streams to EOF instead of using early-exit `grep -q`, preventing the same pipefail/SIGPIPE class from producing false failures or masking forbidden entries.
- Keep the v1.2.43.2 clean-export contract unchanged: compact archive, `EXPORTS.md` + `EXPORT_INDEX.md`, explicit size/entry/SHA-256 logging and fail-closed artifact validation.

## v1.2.43.2 - Embedded ChatGPT auth recovery + clean export

- Keep same-origin `chatgpt.com/auth/*` redirects inside the owned embedded `WebContentsView` instead of automatically converting them into the managed external-browser flow; explicit External mode remains available, while Google OAuth still leaves Embedded mode through the managed browser boundary.
- Default newly-created ChatGPT views to Embedded authentication and serialize explicit `loadURL` operations per owned view. Benign Chromium `ERR_ABORTED` redirect completions no longer strand navigation IPC or accumulate competing load listeners.
- Surface an actionable embedded-auth notice when a linked conversation lands on the ChatGPT login surface instead of leaving the pane indefinitely on “A carregar ChatGPT…”.
- Replace the repository export body with a dedicated clean exporter: exclude historical `patches/`, nested `.harness`, IDE metadata, `.orig/.rej` residues and generated Wharness context/input/bundle payloads; add `EXPORT_INDEX.md` with exclusion policy, top-level inventory and largest included files.
- Make `make export` report archive path, human/byte size, entry count and SHA-256, and strengthen `export-check` so noisy/private artifact classes cannot silently return to the exported project context.

## v1.2.43.1 - Stack session recovery + ChatGPT restore

- Repair Compose PostgreSQL migrations whose old v1 marker was written while the target database lacked legacy sessions: a separate v2 logical reconciliation imports the legacy PostgreSQL 17 data idempotently, preserves newer target rows, verifies session counts, and only then records completion.
- Stop a newly-created ChatGPT WebContentsView from eagerly loading `chatgpt.com/` before the bound conversation restore. The first explicit per-chat navigation now owns the initial load, eliminating the home-vs-conversation `ERR_ABORTED` race that could leave the pane stuck on “A carregar ChatGPT…”.
- Add lifecycle/Desktop regressions for the PostgreSQL reconciliation fence and single-owner initial ChatGPT navigation.

## v1.2.43 - Persistent Docker service stack and tunnel daemon

- Move backend, frontend, PostgreSQL and every tunnel-provider client into one project-owned Docker Compose stack; Electron/Desktop remains the only host service.
- Add a dedicated Go `wharness-tunnel` daemon that owns tunnel processes, persisted request-channel resources and provider credentials independently from backend lifetime. Backend stack mode talks to it only over a bearer-authenticated private HTTP API; backend shutdown intentionally does not stop tunnel sessions.
- Preserve temporary public tunnel URLs across normal `make stop`, backend/frontend replacement and self-evolution activation. Normal stack reconciliation uses `--no-recreate database tunnel` and rolls only backend/frontend with `--no-deps`.
- Add first-run PostgreSQL 17 migration from the previous checkout-owned bind-mounted PGDATA into the Compose named volume, with ownership validation, offline physical copy and a durable one-time marker. Incompatible major versions fail closed instead of copying unsafe bytes. Existing tunnel credentials/state are migrated into the tunnel volume once.
- Change lifecycle semantics: `make build` stages images then reconciles the application stack; `make build-stage` is the self-evolution-safe build that never replaces running services; `make start` reconciles the stack and starts Desktop; `make stop` stops Desktop only; `make stack-stop` and `make stack-down` explicitly control the persistent stack.
- Keep transactional self-evolution viable after backend containerization: the backend image carries the build/control toolchain, activation is handed to a detached one-shot supervisor container that survives backend replacement, and backend/frontend rollout has an image-level rollback path while tunnel/database remain untouched.
- Keep Protected execution isolated even though the backend is containerized: only the backend receives the host Docker socket; runner containers still receive no socket, and host-visible sandbox/context temporary paths live below `.harness/bridge`.
- Preserve the already-applied v1.2.42.5/v1.2.42.5.1 live-context fast-path and completeness correction as the baseline for this rebased distribution, avoiding duplicate `SourceProbe`/lazy-archive hunks.
- Fix daemon-client response decoding so provider/publication/enrollment results are returned only after the authenticated HTTP response is decoded.

## v1.2.42.5.1 - Live context fast-path completeness hotfix

- Restore the three source files accidentally omitted from the rebased v1.2.42.5 distribution patch: the lightweight `contextbundle.SourceProbe` implementation/regression and the TryCloudflare archive-backed lazy route implementation.
- Keep the v1.2.42.5 runtime design unchanged; this hotfix only completes the code already referenced by the applied fast-path changes so the full backend compiles and the live snapshot routes remain lazy/on-demand.
- Add focused coverage for the source-probe dirty detector while existing TryCloudflare route tests exercise archive-backed resources.

## v1.2.42.5 - Live context fast-path

- Make live HTTPS file-map transport the default (`request archive ZIP=false`, `live tunnels=true`) and bump the persisted global transport preference key so installations carrying the former both-on default stop uploading a duplicate request ZIP automatically.
- Warm the configured TryCloudflare Quick Tunnel at backend-session startup instead of creating and probing it inside the first composer preparation.
- Keep context file routes lazy over the authoritative local snapshot: publish one private snapshot per context generation and resolve `files/context/<sha256>` entries from that ZIP only when fetched, instead of eagerly decompressing, writing and copying every context file during `A preparar rotas remotas`.
- Use a lightweight context source probe on the 2-second live monitor and retain a bounded 30-second authoritative refresh, eliminating repeated full project read/hash/ZIP rebuilds while nothing changed.
- Store local context snapshot ZIP entries without Deflate recompression. The snapshot remains a standards-compliant ZIP with identical content hashes, but generation is CPU-light for the route-first transport.
- Keep ZIP request transport available as an explicit compatibility/fallback switch, and update the progress copy to describe route publication rather than obsolete cloud/archive upload semantics.

## v1.2.42.4 - Protected host-apply correction context hotfix

- Preserve a stale-baseline Protected Apply rejection in `LastRepairError` instead of returning it only to the immediate caller, so the next planner turn receives the actionable host-apply failure together with the cumulative pending candidate.
- Keep the existing optimistic-concurrency safety boundary intact: overlapping host edits still block before any patch mutation, and no stale verified candidate is force-applied.
- Publish the same `host.apply_failed` audit event for this pre-mutation failure path with a zero rollback count, making the failure observable without pretending that host files were mutated.
- Use the existing cumulative-host-apply regression as the gate for retained correction context.

## v1.2.42.3 - Recovery liveness no-interrupt hotfix

- Stop the pre-DOM recovery probe from treating an empty liveness snapshot as a silent/dead ChatGPT request; that probe now evaluates recorded transport/renderer faults only.
- Track owned in-flight ChatGPT conversation requests and suppress heuristic silent/surface recovery while the generation transport is still active, so long reasoning is not interrupted by transient DOM detector gaps.
- Arm expected-bundle recovery before automatic submission so immediate conversation transport failures cannot race ahead of request supervision.
- Treat generic Chromium `ERR_FAILED` as recoverable only for the narrow allowlisted ChatGPT conversation transport, preserving fail-closed handling for unrelated requests.
- Add focused regressions for empty-snapshot false recovery, active-transport liveness and scoped `ERR_FAILED` handling.

## v1.2.42.2 - Background ChatGPT liveness and human verification gate

- Disable Chromium background throttling for each owned ChatGPT `WebContentsView` so hidden/inactive inspector panes keep timers and transport supervision alive without stealing focus.
- Detect narrow structural anti-bot/auth/access gates, persistent missing-composer states, stuck page loads, repeated DOM-probe failures, broader DNS/proxy/TLS/HTTP2/QUIC transport failures and HTTP 5xx; keep every automated recovery bounded.
- Back off ChatGPT HTTP 429 responses for 60 seconds, escalate exhausted transport/surface/stalled recovery to explicit human intervention, and pause automation while a human gate is active instead of reloading through it.
- Raise OS notification/window attention plus a persistent Agent command-bar action that opens the affected ChatGPT surface; preserve the no-cookie/no-arbitrary-response-scraping boundary and per-chat renderer ownership.
- Add Desktop recovery/DOM/static regressions and frontend intervention affordance coverage.

## v1.2.42.1 - Definitive background ChatGPT affinity

- Publish ChatGPT state and definitive affinity candidates to the renderer owner window independently of which ChatGPT chat is visually active, preserving background/new-chat binding.
- Separate raw navigation observation from affinity promotion so only a stable, fully loaded concrete conversation URL becomes the binding candidate; keep a late settlement observer active after the initial waiter.
- Make the 30-second conversation waiter fail closed and hold silent/completion recovery reloads during the initial affinity grace window while still allowing concrete transport-fault recovery.
- Keep application state as the single owner of automatic candidate persistence/confirmation and stop local chat-title changes from retriggering remote ChatGPT navigation.
- Add focused Desktop/frontend regressions for inactive-chat publication, transient URL settlement, late affinity capture, recovery isolation and pane ownership.

## v1.2.42 - Composable ChatGPT transports and truthful outcomes

- Replace the exclusive Desktop attachment/tunnel choice with independent global and per-chat ZIP and live-tunnel switches; both-on is the default, either-only is supported, and both-off is prevented.
- Keep ZIP-enabled requests in exactly one inbound archive containing every prompt, context file, `@file` reference, artifact and attachment. ZIP+tunnels also records every live endpoint in priority order inside `transport.json`; composer text remains protocol-bootstrap-only.
- Mirror each live request namespace to every eligible Tunnel Provider in configured priority order and instruct ChatGPT to advance after DNS, connection, timeout, invalid-status or 5xx failure. When a ZIP exists, exhaustion always continues from that archive.
- Publish a versioned `diff-check.json` on every live tunnel and require a fresh ordered-tunnel compatibility pass immediately before bundle delivery, including rechecking actual patch paths against current files.
- Retain a bounded per-request file-hash snapshot so stale patch bundles fast-forward across genuinely disjoint local edits, while overlapping, command-based or unverifiable changes still trigger baseline reprocessing; compatible late bundles retire redundant continuations.
- Require an explicit `outcome` in every new `harness.turn/v1`. Failed/partial planner outcomes are persisted as request failures, never reach Policy/execution, and expose recovery through prompt edits, more context/channels or a fresh retry.
- Remove the legacy `desktop_direct` pseudo-provider from tunnel configuration while migrating existing documents without affecting real tunnel instances.

## v1.2.41 - Single-archive ChatGPT input transport

- Collapse Desktop direct planner input into one request-scoped `wharness-input-<request_id>.zip` containing the transport manifest, authoritative planner prompt, context when required, system artifacts, explicit project-file references and user attachments.
- Send only a bounded composer bootstrap that points ChatGPT to the inner planner prompt, preserving the no-full-prompt-in-DOM boundary while reducing direct transport to one ChatGPT file upload per turn.
- Preserve context hash/conversation refresh behavior, upload confirmation/retry, Manual confirmation and Auto submit gating against the single archive.
- Add the `wharness.chat-input/v1` transport-manifest schema plus Desktop archive/regression coverage and update the transport/security Sources of Truth.

## v1.2.40 - Concurrent context-baseline coordination

- Add deterministic managed-context SHA-256 concurrency tokens to planner requests and execution plans, plus conservative `impact_files` forecasts for change routing.
- Serialize Wharness-controlled host mutations per canonical project root and re-check the current baseline immediately before Execute, Apply and Revert mutation boundaries.
- Broadcast successful Apply/Revert baseline transitions to active parallel chats with previous/new hashes, changed files, overlap and delta completeness; relevant Auto/ChatGPT sessions receive a same-conversation adaptation continuation in background.
- Fast-forward only through complete, non-overlapping baseline-delta chains and always re-run the candidate against a fresh current-host sandbox before host Apply.
- Suppress superseded late bundles so an older parallel response cannot replace a newer baseline-adaptation request.
- Surface baseline synchronization/adaptation state and audit events in the Wharness chat/Inspector, including Unprotected direct-host changes.

## v1.2.39 - Unified Agent workspace and activity drawer

- Replace the permanent Harness-chat/Agent-Inspector split with one end-to-end Agent surface whose top tabs switch between Chat, Plano, Execução and ChatGPT.
- Move Execute, verified Apply and Reject to compact icon-only actions in the unified Agent tab bar while preserving the existing policy/state gates and accessible descriptions.
- Add a JetBrains-inspired left activity rail: archived chats open in a dedicated drawer and a second Project action opens a searchable read-only project tree that hands selected files to the existing Editor flow.
- Convert workspace-topbar operational labels (self-evolution, Auto, host-direct and planner mode) into icon-only status affordances with tooltips/ARIA labels.
- Keep embedded Chat/Inspector chrome out of the unified surface, preserve chat and inspector state across tab switches, and suspend the native ChatGPT view whenever ChatGPT is not the visible Agent tab or a drawer overlays it.
- Harden chat auto-scroll for non-visual DOMs by feature-detecting `scrollIntoView`.
- Add focused frontend regressions for the unified tabs, icon-only Execute action, archived drawer, project explorer and topbar status icons.

## v1.2.38.1 - ChatGPT request rehydration and definitive auto-binding

- Add a bounded ChatGPT request-liveness recovery state machine for active expected bundles: recoverable socket/network and renderer failures re-hydrate the owned page, while silent or stalled processing reloads once and then emits at most one same-request recovery prompt if the request still does not resume.
- Reload once when ChatGPT appears to have completed a response but the expected validated bundle is still absent, before falling back to the existing delivery-continuation prompt.
- Wait for a concrete `chatgpt.com/c/...` URL to be stable and fully loaded after submission, publish that definitive affinity candidate from the Desktop main process, and persist/confirm it from the application controller even when the ChatGPT inspector pane is not mounted.
- Keep recovery bounded and project-safe: no lifecycle commands, no arbitrary assistant-prose scraping, no cross-chat renderer access, and no infinite reload/prompt loop.
- Add Desktop recovery/affinity regressions plus a frontend regression proving candidate persistence is independent of inspector visibility.

## v1.2.38 - Multi-window and bound multi-project workspaces

- Allow Agent and Editor users to open additional independent Wharness desktop windows while keeping a per-window project ownership registry that rejects the same canonical project path in two windows at once and focuses the existing owner.
- Add a persistent top-level workspace shell with **Bind projecto**, fast project switching and one mounted same-origin project frame per binding, so Agent/Editor state, running requests, page state and project-local UI remain alive while another project is selected.
- Scope embedded ChatGPT `WebContentsView` ownership, visibility, bounds and IPC delivery to the desktop window that owns the project/chat, preserving the dedicated-view-per-chat security invariant across multiple windows.
- Persist window identities, bound-project sets and the active project across restart; keep each project renderer mounted during switching so its live page/Agent/Editor state remains intact, and extend self-evolution activation with **Todas agora**, **Apenas esta**, and **Mais tarde** choices.
- Add Desktop regression coverage for window-scoped ChatGPT ownership and the project/window IPC surface.

## v1.2.37.1 - Single-shot successful execution

- Make successful plan execution idempotent across Wharness restarts: once a `plan_id` has a recorded successful sandbox/direct execution or appears in verified/applied history, the backend refuses to execute that same plan again.
- Keep persisted plan/policy/result objects as audit history after self-evolution restart reconciliation without treating them as an actionable task.
- Hide the Inspector Execute action outside actionable `planned`/retryable `failed` states, including `verified`, `restart_pending`, `restart_scheduled` and `applied`.
- Emit an explicit `execution.duplicate_blocked` audit event when a stale/manual caller still attempts the completed plan, and show that protection in the execution timeline.
- Correct manual execution regression fixtures so they do not auto-run once before explicitly calling Execute, while adding dedicated Auto and self-evolution single-shot regressions.

## v1.2.37 - Application-owned dialog system

- Replace every frontend `window.alert`, `window.confirm` and `window.prompt` flow with a unified Wharness-owned modal layer for information, confirmation and text input.
- Give confirmations explicit semantic tones and action labels, polished responsive styling, keyboard/focus handling and overlay-blocker semantics so critical actions remain clear without browser-native chrome.
- Move Explorer create/rename input into validated application modals and keep destructive file, terminal-host, execution-mode, Apply/reject/revert and browser-session operations behind explicit Wharness confirmations.
- Make native browser dialog APIs a prohibited UI pattern in `SoT/UI_UX.md` and enforce the rule in ESLint so future regressions fail the normal lint gate.
- Add focused modal regressions covering confirmation, prompt validation and informational notices.

## v1.2.36.1 - Composer mode selected palette

- Replace the harsh generic dark/lime selected treatment on the composer mode choices with quieter semantic palettes designed for the light composer surface.
- Give Protected a cool blue selected state and Manual a warm amber state; align Unprotected to restrained red and Auto to soft green so all four choices remain visually distinct and coherent.
- Preserve the existing icons, tooltips, `aria-pressed` state and safety behaviour; this is a visual refinement only.
- Add a focused CSS regression covering the selected-state palette contract.

## v1.2.36 - Composer execution mode icons

- Move the Protected/Unprotected and Manual/Auto project choices out of the workspace top bar and into compact icon groups in the Wharness chat composer action rail.
- Keep current execution and automation state visible through selected icon states and tooltips while preserving the existing HOST DIRETO/AUTO status pills in the top bar.
- Preserve safety semantics: self-evolution keeps Unprotected disabled, Auto still forces Protected, and the existing mode-change confirmations/notices remain owned by the application controller.
- Add focused frontend regressions for composer mode placement, callbacks and self-evolution locking.

## v1.2.35 - Auto self-evolution execution gate fix

- Keep normal project-defined build/test/runtime commands (`node`, `npm test`, `npx`, `make`) medium-risk and observable without turning them into an implicit per-plan approval gate; in Protected Auto they execute only inside the sandbox and therefore no longer stall valid self-evolution changes at `planned`.
- Preserve explicit approval for planner-requested approval, network access, package mutation such as `npm install`, Git mutation and high-risk plans.
- Make the remaining Auto approval stop explicit through `auto_error`/`automation.approval_required` instead of silently importing a valid bundle without explaining why execution did not start.
- Add a full self-evolution regression proving that Auto performs sandbox verification, host Apply and host build, reaching only the intentional `restart_pending` activation confirmation when a change uses a normal project verification command.

## v1.2.34.4 - Composer send right inset

- Keep the send action deterministically anchored at the far-right composer rail while adding an 8px inner inset so the icon no longer sits flush against the composer edge.
- Preserve the existing absolute positioning, toolbar independence and 40px reserved rail; only the visual breathing room at the right edge changes.
- Update the focused composer CSS regression to assert the final effective `right: 8px` anchor.

## v1.2.34.3 - Visible ChatGPT affinity rebind hotfix

- Allow the explicit **Vincular esta** action to replace an existing ChatGPT conversation affinity when the requested conversation is exactly the concrete conversation currently visible in that chat's owned renderer.
- Keep silent or stale rebinding fail-closed: confirmations without a matching active candidate still conflict unless the renderer itself is visibly on the requested conversation.
- Add focused affinity and Desktop IPC regression coverage for the visible-conversation rebind path.

## v1.2.34.2 - Deterministic composer send anchor

- Fix the actual cascade/layout failure that can keep the send action immediately after the left control cluster: the footer retained a legacy `justify-content: space-between` after becoming a grid, so its implicit content track may remain narrower than the composer.
- Make the footer a full-width positioning context, reserve the send rail, and anchor the send button absolutely at `right: 0` so its horizontal position no longer depends on toolbar/grid intrinsic sizing.
- Keep the existing composer controls and send behavior unchanged, while strengthening the CSS regression to assert the final effective footer, toolbar and send rules.

## v1.2.34.1 - Composer send edge alignment

- Remove the residual right padding from the pinned composer footer so the send button sits flush against the far-right internal edge as required by the UI/UX contract.
- Preserve breathing room for the helper hint independently and add a focused CSS regression test for the alignment.

## v1.2.34 - Batched pending self-evolution

- Replace the single pending self-evolution deadlock with one atomic pending batch: after a verified host build reaches `restart_pending`, additional verified Wharness changes may extend the same transaction without restarting first.
- Keep the original source/runtime/lifecycle rollback baseline for the whole batch while snapshotting newly touched paths only once, so a later failure rolls the complete pending batch back to the runtime that is actually running.
- Add a short-lived stage lock on top of the durable batch lock so Apply/build/revert/restart transitions stay serialized while the idle `restart_pending` state remains extendable.
- Persist every session/plan participating in the batch, allowing any member to confirm activation and keeping all participating sessions synchronized through restart, rollback and reconciliation.
- Retain completed transaction metadata until the restarted backend reconciles all batch members, then clean it up; the detached supervisor also clears both batch/stage locks.
- Clarify the restart dialog that choosing Later can safely accumulate more verified changes into the same pending activation.
- Track pending activation independently from the current chat task, so choosing Later releases the request queue for additional work while the restart control remains available even after that session advances to a newer request.
- Keep the durable batch lock on a failed restart handoff so the same baseline can be retried or safely extended instead of accidentally starting a second rollback universe.

## v1.2.33 - Dedicated ChatGPT renderer per Harness chat

- Give every live Harness chat its own owned ChatGPT `WebContentsView`/`webContents` instance instead of treating the active remote surface as a reusable renderer.
- Key state, bounds, navigation, history, reload, focus, clipboard and allowlisted DOM transport operations by Harness chat id and reject ownership mismatches before remote interaction.
- Keep the persistent ChatGPT partition shared only for authenticated browser-session state, so login remains reusable without sharing DOM/composer/page renderer state between chats.
- Stop silent remote-view eviction/reassignment; permanent local chat deletion explicitly destroys that chat's renderer, while process restart recreates renderers from stored per-chat conversation affinity.
- Ignore stale renderer state events from non-owning chats in the active ChatGPT pane and add regression coverage for per-chat renderer ownership and keyed IPC.
- Correlate intercepted plan/bundle downloads back to the owning chat and make the frontend ignore unowned download/state events, preventing a background ChatGPT instance from feeding artifacts into whichever Harness chat is currently visible.

## v1.2.32 - Auto-growing composer action rail

- Grow the Wharness chat composer automatically as multiline text expands, up to the existing bounded maximum, while retaining bounded manual resize and per-chat height persistence.
- Keep the composer action/footer rail outside the scrolling text region so artefact, attachment, Plan-first, queue, TODO and send controls remain visible when long prompts overflow.
- Anchor the send button flush to the right edge of the composer action row and add focused regressions for action visibility and multiline growth.

## v1.2.31 - Readable workspace, execution timeline and safe regression

- Recalibrate the visible 100% typography baseline for readability, expand UI scaling to 80%-160%, and apply the shared scale to previously fixed small interface text while retaining Inter/Manrope + JetBrains Mono defaults.
- Rework the chat composer into one resizable scroll surface with roomier text, Portuguese Chromium spell checking, right-aligned submit control and per-chat draft/height persistence across Agent/Editor mode switches.
- Correlate command stdout/stderr/completion into one execution item, collapse details by default while opening the newest five, follow the active tail, and show execution timestamp, duration and running animation. Host patch Apply/revert and self-evolution build phases now appear in the same timeline.
- Add post-Apply change summary cards with per-file +/- counts, focused unified-diff inspection, Editor navigation and deterministic reverse-patch regression for the current Protected patch-only plan.
- Hide the native embedded ChatGPT view whenever trusted Wharness modals, dialogs, menus or popups are present so `WebContentsView` can no longer paint over them.
- Make same-task ChatGPT comments single-flight and idempotent across timer/immediate flush races, with short semantic duplicate suppression to prevent accidental repeated guidance.

## v1.2.30 - Request queue and resilient ChatGPT delivery

- Introduce a per-chat main-request queue: Enter always creates the next main request and waits until the active request plus workflow/repair continuations are terminal; Ctrl+Enter sends an immediate same-request comment while work is in flight.
- Add queue controls to promote a waiting request into a live comment, reorder entries, edit text, remove entries and merge adjacent requests, while clearing the composer immediately on submit.
- Move TODO progress into a dedicated composer task surface that tracks the latest checklist snapshot instead of rendering implementation checklists as loose transcript content.
- Make iteration artifact icons actionable: context, prompt, execution result and error evidence open in a focused inspector, and refine Wharness operational notices into calmer semantic cards.
- Right-align the composer send affordance and make the active-request keyboard contract explicit in the helper text.
- Give generic clipboard screenshots unique local filenames so multiple image.png captures can coexist in one ChatGPT-bound request.
- Broaden canonical bundle DOM discovery to nearby file-card metadata and add completion-aware delivery continuations when ChatGPT finishes a turn without exposing the required bundle; validated download remains authoritative.
- Allow queued task comments to carry user attachments and preserve multiple rapid comments instead of overwriting the previous pending comment.

## v1.2.29 - Incremental compiled-artifact cache

- Add per-component build fingerprints for backend, frontend and desktop so `make build` reuses successful compiled artifacts when their exact source/config/runtime inputs are unchanged.
- Skip the complete Vite production pass on frontend cache hits, avoiding repeated transformation of Monaco Editor's large ESM graph during backend-only, desktop-only or no-change rebuilds.
- Reuse a previously successful pre-v1.2.29 build on first adoption when the global build-success stamp proves no relevant component input changed afterwards.
- Keep fail-closed lifecycle semantics: the active build-success stamp is removed while a build is in progress, component stamps are written only after successful commands, and missing outputs always force recompilation.
- Add `make build-status` for artifact-cache diagnostics and `make build-refresh` to force recompilation without discarding dependency caches.

## v1.2.28 - Fast deterministic rebuilds

- Replace unconditional `go mod download` / `npm install` work in every `make build` with dependency fingerprints stored under `.harness/cache/dependencies`.
- Skip npm entirely when `package.json`, `package-lock.json`, runtime versions and the validated local install have not changed; safely adopt a recent npm hidden lock on the first build after upgrade.
- Use deterministic `npm ci --prefer-offline --no-audit --no-fund` only on real dependency invalidation, reusing the existing Wharness npm content cache without contacting audit/funding endpoints.
- Build backend, frontend and desktop concurrently with a conservative default of two jobs while preserving fail-fast build stamps and the Docker-free application lifecycle.
- Add `make deps-status` for cache diagnostics and `make deps-refresh` as an explicit recovery path when operators intentionally want dependency re-hydration.

## v1.2.27 - Calm composer, plan-first turns and Git-aware execution

- Refine the Wharness composer into a clean bottom action rail with small circular artefact controls, file attachment and a Plan-first toggle embedded inside the writing surface.
- Separate transcript semantics into user, ChatGPT and Wharness sources; operational lifecycle notices and visible ChatGPT activity use dedicated notification/thought surfaces instead of masquerading as normal chat messages.
- Add Plan-first requests: the first ChatGPT turn is proposal-only, Wharness rejects executable bundles for that request, presents the proposal with approve/reject controls, and creates a separate implementation request only after explicit approval.
- Require every ChatGPT CHANGE deliverable to expose a user-visible `## TODO` checklist so implementation progress is traceable in the transcript.
- Allow task comments from the composer while ChatGPT is processing; comments stay bound to the same request/conversation and explicitly preserve the original canonical bundle deliverable.
- Capture only reasoning/status content visibly exposed by the ChatGPT UI and render it as transient thought/activity, without accessing hidden model reasoning, cookies, storage or arbitrary response prose.
- Add policy-aware Git CHANGE support for read-only inspection plus approved mutations such as add/commit/branch/switch/merge/rebase/revert/restore/tag/stash and network-declared fetch/pull/push; destructive/force operations remain denied.
- Preserve real Git history and current working-tree state in Protected sandboxes through a hook-free local clone; only credential-free HTTPS remote URLs are reconstructed, and Protected push is exercised as `--dry-run` before any approved host replay.
- Interleave streamed stdout/stderr directly below the command event that produced it in the Execution timeline instead of collecting output in a detached final log card.

## v1.2.26 - Composer artifacts, durable iterations and confirmed self-restart

- Move ChatGPT transport controls out of the ChatGPT header and into compact artifact selectors embedded directly in the Wharness chat composer for Context ZIP, Prompt, Result, Error and user files.
- Automatically select context when another Harness chat changes the project snapshot, and select result/error evidence after executions or repair paths while keeping the user able to toggle non-required artifacts.
- Persist execution events per Harness chat so reopening Wharness or switching chats restores the execution history instead of resetting the execution tab.
- Persist a Wharness-side iteration reference with request id, phase, ChatGPT conversation and attached artifact kinds for outbound, workflow, repair and result turns.
- Collapse authenticated ChatGPT state to a single compact status icon, remove the manual ZIP/prompt/result action cards and retire the Desktop manual fallback panel.
- Change transactional self-evolution so a verified host build stops at restart-pending and requires explicit user confirmation; choosing Later leaves a restart badge visible and keeps rollback state available.
- Add local typography settings with an elegant 110% default, selectable UI/monospace font stacks and a 90%-130% interface scale.
- Add regression coverage for composer artifact placement, execution-history persistence, compact ChatGPT auth UI, typography preferences and restart-confirmation transaction recovery.

## v1.2.25 - Chat affinity, recoverable archive and live execution logs

- Arm first-conversation affinity as soon as the trusted ChatGPT new-chat surface is observed, including while it is still loading, then wait longer for the post-submit `/c/...` transition before finalizing the binding.
- Keep ChatGPT conversation affinity one-to-one: a concrete conversation already owned by another Harness chat is rejected instead of being silently duplicated.
- Replace destructive close-on-X with a recoverable local archive. Archived chats preserve transcript, ChatGPT binding and durable attachments; the archive area can reopen them or perform explicit confirmed permanent deletion.
- Stream command stdout/stderr chunks from Local, Docker and Host runners through SSE `command.output` events while operations are executing.
- Redesign the Agent execution tab as a compact event timeline followed by a live aggregated log console, with the inspector as the single vertical scrolling surface instead of per-operation nested output scrolls.
- Add regression coverage for first-chat binding while loading, archive/restore/permanent-delete semantics, live runner output and the execution log UI.

## v1.2.24.1 - Immutable Linux Electron runtime

- Move the Linux Electron execution binary and its SUID `chrome-sandbox` out of npm-managed `node_modules` into a versioned root-owned runtime under `/opt/wharness/electron/<version>-linux-<arch>/`.
- Make the complete runtime root-owned and non-user-writable, keep `chrome-sandbox` at `root:root` mode `4755`, and verify the Electron/helper SHA-256 values from a root-owned runtime manifest before every launch.
- Resolve the exact current Electron version/architecture at startup and pass its immutable absolute binary to the desktop coordinator, so `npm install`, `npm ci`, `make build`, worktree changes and dependency cleanup cannot reset sandbox permissions.
- Keep user namespaces only as a verified fallback, continue to forbid `--no-sandbox`, remove the obsolete standalone helper during runtime installation, and retain the old `electron-sandbox-*` Make targets only as compatibility aliases.
- Route `make start`, `make run-desktop`, `npm run dev` and `npm start` through the same runtime resolver so no supported desktop launch path falls back to `electron .` from `node_modules`.
- Add regression coverage proving the desktop honors an absolute immutable runtime binary and lifecycle checks preventing privileged in-place `node_modules` sandbox configuration from returning.

## v1.2.24 - Network-stable Docker lifecycle

- Decouple `make build` from the Docker runner so normal `make build && make start` never contacts or socket-activates the Docker daemon.
- Move Docker CLI/runtime prerequisites to the explicit `make build-runner` path and add `make build-all` for operators who intentionally want the application and runner together.
- Stop Dockerfile-only changes from invalidating the desktop application build stamp now that the runner has an independent lifecycle.
- Refuse Linux systemd Docker socket activation before Protected execution or runner construction when `docker.service` is stopped but `docker.socket` is listening, preventing Wharness from implicitly rebuilding host bridges/routes/veth devices mid-session.
- Add lifecycle regression checks plus backend unit coverage for the socket-activation policy.

## v1.2.23.2 - Electron packaged SUID sandbox correction

- Fix Linux Electron startup after v1.2.23.1 incorrectly treated a valid persistent helper as sufficient even though packaged Electron continued validating its adjacent `node_modules/electron/dist/chrome-sandbox`.
- Treat only the Electron-packaged helper as a valid SUID launch path and stop exporting `CHROME_DEVEL_SANDBOX` from the Wharness lifecycle.
- Add `make electron-sandbox-install` to configure the exact Electron helper as `root:root` mode `4755`, plus a recovery-copy restore target and metadata-rich diagnostics.
- Preserve the secure user-namespace fallback and continue to forbid `--no-sandbox`.

# Changelog

- Bound local storage growth and make `make build` reclaim it. The running checkout had reached 27 GB: 21.6 GB was unreferenced data under `.harness/bridge/tmp`, including 1,996 context directories and 50 copied sandboxes, while seven obsolete Go module-cache keys added another ~1 GB. Session deletion removed only the current context directory and left every retained request base behind; crashes/restarts had no owner-aware sweep at all. Deletion now removes all context directories owned by that session, failed persistence removes its just-built context, backend startup reclaims only old unreferenced Wharnex temporary directories and dependency-cache hashes that match no open project, and `make build` explicitly invokes the same backend-owned cleanup after a healthy rollout. The sweep refuses the shared operating-system temp directory, preserves referenced request bases and live devspaces, ignores unknown names, and leaves durable events/artifacts untouched.

- Fixed ChatGPT bundle interception when Chromium adds a duplicate-download suffix such as `(1)` to an otherwise canonical bundle filename; normalization remains restricted to the exact active request id.

## v1.2.23.1 — Secure Linux Electron sandbox startup hotfix

- Detect the Linux Electron sandbox capability before startup instead of letting Chromium abort with an opaque `chrome-sandbox` SUID fatal error.
- Prefer a persistent root-owned mode-4755 helper outside `node_modules`, and verify that it is byte-identical to the helper shipped by the installed Electron version so npm reinstalls cannot silently invalidate startup.
- When a privileged helper is unavailable, probe unprivileged user namespaces and use only `--disable-setuid-sandbox` when that sandbox path is actually usable; never fall back to `--no-sandbox`.
- Fail closed with actionable installation commands when neither secure Linux sandbox path is available, and expose `make electron-sandbox-check` for diagnostics.

## v1.2.23 — Transactional self-evolution

- Detect when a managed project resolves to the exact root of the currently running Wharness instance and mark the session as self-evolution.
- Force self-evolution sessions to Protected execution and prevent later Unprotected switching.
- After sandbox verification, snapshot patch-touched source files and known-good runtime artifacts before applying the patch to the live Wharness root.
- Rebuild the real host with deterministic npm installs, reject unexpected dependency-metadata mutation, and rollback immediately if host Apply/build fails.
- Hand restart to a detached supervisor so the process being upgraded does not own its own termination/recovery path; health-check the new runtime and automatically restore/restart the previous version on failure.
- Reserve `.harness/**` as runtime-owned recovery state, persist self-evolution lifecycle status/logs, surface the mode in the workspace UI, and teach the planner not to emit Wharness lifecycle commands.

## v1.2.21.1 — Bundle download fallback + rendered Harness Markdown

- Harden automatic ChatGPT result capture when generated files are rendered without their canonical filename: exact filename metadata remains preferred, with a fail-closed fallback to exactly one visible file/download affordance in the newest assistant turn.
- Include href/download/accessibility metadata in the narrow download-control matcher without scraping assistant prose or weakening post-download request/bundle validation.
- Strengthen the manual planner contract so generated bundle basename, attachment metadata and visible label use the exact canonical `wharness-bundle-<request_id>.zip` and reject icon-only substitutes.
- Render Harness/agent transcript responses as sanitized GitHub-flavoured Markdown while preserving user messages as literal text.
- Add regression coverage for exact-vs-icon-only download selection, ambiguous fallback rejection, and Markdown headings/emphasis in Harness responses.

## v1.2.22 — Persistent managed Chrome account + personal Chrome shortcut

- Keep the real-browser OAuth callback profile under Wharness `userData` instead of deleting a fresh temporary Chrome profile after every login, so the Google account and ChatGPT session can be reused on subsequent external authentications.
- Keep callback automation isolated from the user's personal/default Chrome profile; Chrome 136+ intentionally blocks remote-debugging against that profile, so Wharness does not bypass the browser's credential protections.
- Add a visible **Chrome pessoal** action that opens the normal system browser with its already-active profile/session for manual use, while clearly keeping it separate from the callback-capable managed profile.
- Serialize callback-capable external authentication across chats because the persistent managed profile is shared.
- Make **Limpar sessão do navegador** and full Wharness reset delete both the embedded Electron browser state and the persistent managed-browser auth profile; storage metrics include both browser stores.
- Add regression tests for the persistent profile location and the personal-Chrome shortcut.

## v1.2.21 — Export provenance + Git/runtime diagnostics

- Add a generated root `EXPORTS.md` to `make export` archives with export provenance, project metadata, current Git branch/HEAD, `git status --short --branch --untracked-files=all`, and `git worktree list --porcelain`.
- Capture Wharness runtime diagnostics in `make export`: current `scripts/status.sh` output plus a bounded tail of `.harness/logs/desktop.log`, with secret-like values redacted and collection failures represented as warnings instead of aborting the export.
- Keep `.git` internals and Git remote URLs out of exports while preserving enough repository state for offline analysis.
- Add the same synthetic `EXPORTS.md` to every Wharness-managed context ZIP/text export without writing it into the managed project.
- Include deterministic Git/export metadata in the context fingerprint so branch/index/worktree changes invalidate smart-context affinity when analytically relevant.
- Harden `make export-check` and backend tests to verify metadata presence and Git-state capture.

## v1.2.21 — Real-browser OAuth callback relay

- Replace the v1.2.20 detached Electron auth `BrowserWindow` with a real installed Chrome/Chromium/Brave process using a unique temporary Wharness profile.
- Bind Chrome DevTools only to loopback, always restart auth from `https://chatgpt.com/auth/login`, and never forward an in-flight OAuth provider URL between browser contexts.
- Detect an authenticated ChatGPT callback in the managed browser, relay only non-Cloudflare `chatgpt.com` cookies directly in the main process to `persist:wharness-chatgpt`, then close/delete the temporary browser profile and reload the embedded ChatGPT view.
- Automatically promote Google OAuth out of Embedded mode because Google rejects embedded user-agents instead of attempting unsafe browser spoofing.
- Add auth-error IPC/UX and fix the frontend race that cleared the external-auth banner before its controls rendered.
- Add managed-browser/cookie-relay regression tests.

## v1.2.20 — Dual ChatGPT authentication + same-session callback

- Add explicit **Login incorporado** and **Login externo** modes to the ChatGPT panel.
- Keep embedded OAuth entirely inside the sandboxed ChatGPT `WebContentsView` when the user selects it.
- Replace the broken system-browser handoff of in-flight OAuth URLs with a fresh `chatgpt.com/auth/login` flow in a separate Wharness-owned sandboxed auth window sharing the same persistent ChatGPT partition.
- Detect the external-window callback only from top-level return to non-auth `chatgpt.com`, then close the auth window and reload the embedded view without reading or copying cookies/tokens.
- Keep the operating-system browser button as a clearly isolated manual fallback with no callback claim.
- Add security/regression tests for auth URL classification, strict auth modes, shared-partition external login, and prevention of provider-URL forwarding.

## v1.2.19 — Intent-first ASK and bounded iterative workflows

- Reframe the planner as a project copilot instead of a coding-first agent: ASK/advice/recommendation requests now explicitly prefer direct `answer` outcomes, while only explicit mutation intent becomes `change`.
- Add `workflow` to `harness.turn/v1` for non-terminal local evidence gathering without converting diagnostics into code changes.
- Execute workflow plans only as command-only, network-disabled probes in disposable Protected sandboxes; patches, host Apply and host-approval semantics are forbidden.
- Feed structured stdout/stderr/exit observations back into a fresh request in the same planner/ChatGPT conversation and repeat for at most six rounds before requiring a terminal result.
- Automatically submit workflow continuations through the existing file-first, upload-confirmed ChatGPT transport and preserve smart context affinity by conversation URL + project SHA.
- Keep workflow failures as reasoning evidence rather than entering the automatic change-repair loop; a terminal provider change still follows the normal Policy -> sandbox -> verify -> Apply path.
- Make Agent Inspector distinguish local workflow probes from change plans and prevent workflow plans from exposing manual Execute/Apply controls.
- Define an MCP-ready adapter boundary without adding an unnecessary runtime dependency: future MCP capabilities must remain behind Wharness Policy, containment and sandbox ports.

## v1.2.18.3 — Frontend test isolation hotfix

- Register one explicit Vitest setup file that cleans React Testing Library renders after every frontend test.
- Prevent DOM from prior test cases leaking into later `screen.*` queries and producing false duplicate-element failures in `ChatPanel` and `ContextInspector`.
- Keep production behaviour unchanged; this patch only hardens the frontend quality gate.

## v1.2.18.2 — Chat UX, smart project context and safe defaults

- Add copy controls and visible date/time metadata to every Harness transcript message, with safe migration for legacy stored items.
- Start every opened/restored project in Agent + Protected + Auto, while preserving the invariant that Unprotected cannot coexist with Auto.
- Replace the ChatGPT helper strip with compact action cards for project context, current prompt and expected result; context/prompt can be copied or explicitly sent to the currently open ChatGPT conversation.
- Track the last project-context SHA and ChatGPT conversation URL per Harness chat: attach a fresh context ZIP on the first turn, on a newly opened ChatGPT conversation, or after the project snapshot changes; omit duplicate ZIPs on unchanged sequential turns.
- Treat an explicit Harness send while another ChatGPT conversation is visibly open as an intentional rebind and refresh context without weakening the existing allowlisted DOM transport.
- Prevent the project Rules inspector from crashing on legacy/null collection payloads and make backend context inspection serialize empty roots, entries and rule patterns as arrays.

## v1.2.18.1 — Project settings storage test hotfix

- Align the `ProjectSettings` unit-test API mock with the v1.2.18 storage metrics calls so the frontend quality gate no longer fails with `api.storage is not a function`.
- Keep the fix test-only; production storage behaviour introduced by v1.2.18 is unchanged.

## v1.2.18 — Auto repair, background ChatGPT transport and local-data controls

- Surface Policy denial reasons as non-executed events and automatically enter the bounded Auto repair loop without weakening Policy.
- Add a narrow allowlisted ChatGPT DOM bridge for background composer fill/submit and exact expected bundle-download activation; canonical download and bundle validation remain authoritative.
- Add opaque export/import and explicit clearing of the embedded ChatGPT browser session.
- Add complete Wharness data reset with `APAGAR WHARNESS` confirmation while preserving real project directories and files.
- Add disk-consumption metrics for Wharness-owned browser data, attachments, contexts/sandboxes, temporary data and per-project state.
- Route repair/status transcript messages back to the originating Harness chat even when that chat is in the background.

## v1.2.17.5.3 — ChatGPT composer reference hotfix

- Confirm `preparePromptForChatGPT` uses the background `targetChatGPTComposer` helper after the transport refactor removed `focusChatGPTComposer`.
- Add a Desktop regression test that prevents the stale helper reference from returning in the prepare-prompt path.
- No production source rewrite is required in snapshots where the helper call is already corrected; rebuild/restart is sufficient to load the fixed Desktop process.

## v1.2.17.5.2 — Background repair transport build hotfix

- Remove the stale `setChatgptFocusNonce` call from automatic repair submission after the focus-nonce state was intentionally removed by v1.2.17.5.
- Keep repair prompt delivery on the background ChatGPT bridge without switching the visible Inspector tab or requesting remote WebContents focus.
- Restore the frontend TypeScript/Vite build after the background-transport refactor.
- Make `npm run typecheck` use TypeScript project-reference build mode so it checks `tsconfig.app.json`/`src` instead of succeeding against the empty root `tsconfig.json`.

## v1.2.17.5.1 — Frontend test isolation hotfix

- Explicitly clean up `ChatGPTDesktopPane` test renders between Vitest cases so prior DOM/native-view effects cannot leak into the next assertion.
- Scope the canonical bundle filename assertion to the download step instead of querying the whole document, where the same filename is intentionally repeated in fallback guidance.
- Prevent the failed assertion path from leaving React work scheduled past jsdom teardown and emitting a misleading `window is not defined` unhandled error.

## v1.2.17.5 — Bundle contract hardening and background ChatGPT transport

- Harden manual planner output to one exact `wharness-bundle-<request_id>.zip` attachment with root-layout/self-check rules and no visible prose.
- Bind Desktop downloads to the pending request so generic ChatGPT ZIP names are safely normalized to the canonical filename while mismatched Wharness request ids remain rejected.
- Add narrow non-executable bundle compatibility normalization for one wrapper folder, missing README documentation, and root-level referenced patch files.
- Stop automatic prompt/upload/submit transport from switching the Inspector to ChatGPT or explicitly focusing the remote WebContents.

## Unreleased — v1.2.17.3 ChatGPT overlay suspension hotfix

- Removes the unconditional native ChatGPT `show()` performed during pane bootstrap. Visibility is now controlled only by the dedicated `suspended`/chat effect, so a trusted Wharness modal cannot race with an initial WebContentsView show.
- Restores the overlay regression test expectation: mounting `ChatGPTDesktopPane` already suspended must call `hide()` without any preceding `show()`, then show exactly when suspension is lifted.

## Unreleased — v1.2.17.2 project recovery + IDE Explorer + terminal policy

- Restored sessions self-heal a missing `whaness.yml` through the same validated default creation path used by newly opened projects; the settings dialog now exposes a retryable error state instead of remaining forever on “A carregar configuração…”.
- Project settings temporarily suspend the native ChatGPT `WebContentsView`, preventing remote content from painting above the Wharness modal.
- The Editor Explorer is now dark and IDE-oriented, with create file/folder, rename, recursive delete confirmation, path search/filter, refresh, collapse-all, copy path, context menu, F2/Delete shortcuts, active-file reveal, and file/folder counts.
- Explorer create/rename/delete operations are backend-enforced host mutations with project-root containment, excluded/secret path denial, symlink denial, and corresponding sandbox-copy mirroring when a devspace exists.
- The human interactive terminal now uses a dedicated Policy Engine profile instead of model-plan policy, allowing normal project-development argv commands while continuing to block shells, privilege escalation, container/host administration and inline-code evaluator flags. The UI adds command history (Up/Down) and Ctrl+L clear.
- CORS now advertises PATCH so Explorer rename works from the Vite renderer to the local backend.
- DOMPurify is pinned/overridden to 3.4.14 to remove the direct dependency audit finding exposed by 3.4.8; Monaco remains 0.56.0 until upstream publishes a newer stable release.

## Unreleased — Monaco 0.56 Vite worker export-map hotfix

- Uses Monaco 0.56 public package-export worker specifiers (`monaco-editor/editor/...` and `monaco-editor/language/...`) instead of legacy `monaco-editor/esm/vs/...` deep imports.
- Restores Vite 7/Rollup worker resolution for the editor, JSON, CSS, HTML and TypeScript workers without externalizing Monaco or weakening the bundle.

## Unreleased — React 19 / Monaco build hotfix

- Fixes the Monaco editor ref initialization for React 19 typings by using an explicit nullable ref.
- Uses Monaco 0.56-compatible hover and lightbulb option values instead of incompatible boolean/string literals.
- Clears the disposed editor ref back to `null`, matching its React ref contract.

## Unreleased — rendered plans + IDE editor + terminal targets

- Plan summaries and result README content now render sanitized GitHub-flavoured Markdown instead of displaying raw Markdown syntax.
- The Editor replaces the plain textarea with Monaco, adds multi-file tabs, per-file undo/view state, syntax-aware models, minimap, folding, bracket guides, sticky scroll, search/navigation shortcuts, breadcrumbs, cursor/language/encoding status and explicit save handling.
- The Editor file tree adds path filtering while preserving the existing backend file-policy boundary.
- The interactive terminal now defaults to `Sandbox` but allows an explicit human-only `Host` target after a dedicated confirmation; a persistent HOST warning remains visible while selected.
- Host terminal commands execute argv directly through the host runner and the same executable Policy Engine. Sandbox-only network/reset controls are unavailable in Host mode.
- Switching project/session always resets the interactive terminal to Sandbox so Host selection never leaks into a different project.
- Normative execution, sandbox, security and UI documents plus ADR-0008 record the Host-terminal exception and its guardrails.

## Unreleased — ChatGPT submit acknowledgement hotfix

- Auto mode emits the native Enter submit gesture exactly once after attachments settle; an observation timeout is now diagnostic instead of triggering repeated Enter presses.
- A ChatGPT network-observation miss no longer turns an already-dispatched prompt into a `prepare-prompt` IPC failure or causes the attachment draft to be repeatedly disturbed.
- Confirmed conversation POST observation is still logged when available, while file-first result download remains the authoritative completion signal.

## Unreleased — intent-aware agent turns

- Adds the structured `harness.turn/v1` envelope with answer, clarification, investigation, change, and blocked outcomes.
- Questions and non-mutating analysis now return their complete message to the Harness transcript without entering execution or Apply.
- Manual ChatGPT result bundles use `turn.json`; only change bundles include `plan.json` and patches. Legacy plan-only bundles remain compatible.
- Supported provider results bypass browser downloads, and provider change plans complete the Auto sandbox/verification/Apply pipeline directly.
- A new request supersedes older pending manual requests so delayed stale bundles cannot execute later in Auto mode.
- The embedded ChatGPT UI now states that the remote surface must initiate the result download; Wharness imports it automatically after it starts.
- The Plan inspector now tolerates legacy persisted plans whose empty operation or verification arrays were serialized as `null`; new plans are normalized to arrays before persistence.

## v1.2.14.2 — Definitive ChatGPT conversation binding

- New Harness Chats no longer adopt whichever `/c/...` conversation happens to be visible while the ChatGPT view initializes.
- An unbound Harness Chat is armed only after the trusted ChatGPT new-chat/home surface is observed; the first subsequent concrete `/c/<id>` URL becomes the automatic link.
- Returning to an unbound cached chat preserves the home DOM/draft when already on the new-chat surface, while a stale concrete conversation is reset to home before binding can arm.
- Existing linked chats keep explicit mismatch handling: `Vincular esta conversa` appears only when the current concrete conversation differs from the stored link.

## Unreleased — Harness chat attachments

- The Desktop Harness composer accepts up to 10 user-selected files (25 MiB each, 100 MiB total).
- `Ctrl+V` in the Harness composer now converts files from the native clipboard into attachments.
- Enter prepares the linked ChatGPT draft with the refreshed project context ZIP, selected files, and planner prompt.
- A separate “Confirmar e enviar” action emits Enter only after the user visually confirms the attachments in ChatGPT; Wharness does not inspect the remote DOM.
- In explicit project Auto mode, Desktop now submits the prepared ChatGPT prompt after a bounded attachment settle delay and waits for the validated bundle download event.
- Manual planner prompts now require the final visible response to contain only the downloadable bundle, with no descriptive text, Markdown, inline JSON, or patches.
- Harness chat attachments are now persisted in private Desktop application storage before submission; transcript entries keep durable opaque references so reload/restart restores the files with the conversation.
- Image files get persisted thumbnails when Electron can decode them; other file types fall back to the native OS file icon. Persisted attachment cards can be opened explicitly from chat history.

## v1.2.12.1 — Baseline diagnostic fingerprints

- Protected verification now compares structured TypeScript diagnostics when raw output differs only by runner/npm noise.
- Existing TypeScript failures are tolerated only when the post-patch diagnostic set contains no new error fingerprint.
- Unstructured verification failures keep the previous strict output comparison.

## v1.2.12 — durable agent state + differential verification + ChatGPT DOM cache

- Persiste sessões do backend em `.harness/state/sessions.json`, incluindo plano validado, policy, request ids pendentes, último prompt e último resultado de execução.
- Reiniciar `make stop` / `make start` deixa de apagar o plano/requisição do Harness Chat.
- Protected Mode compara um gate que falhou com uma sandbox pristine; uma falha preexistente só é tolerada quando exit code e diagnóstico permanecem idênticos.
- Regressões novas ou diagnósticos diferentes continuam a bloquear a execução.
- ChatGPT Desktop mantém até 20 `WebContentsView` vivos em LRU, um por Harness Chat, preservando o DOM em memória nas trocas de chat. O botão Reload continua a forçar refresh do chat ativo.

## 1.2.11 — Protected sandbox dependency hydration (2026-09-03)

### Fixed
- Protected Node.js verification no longer fails with `tsc: not found` merely because `node_modules` is excluded from the context/sandbox snapshot.
- `npm run`, `npm test`, `npm exec`, `npx`, and equivalent pnpm/yarn/bun script execution lazily hydrate local `node_modules` into the isolated workspace before the command runs.
- Missing host dependencies now produce an actionable `sandbox node dependencies unavailable` error instead of a misleading package-script exit 127.

### Security
- `node_modules` remains excluded from model context and the initial sandbox copy.
- Dependencies are copied into the temporary sandbox only when a local Node command needs them; the real project is never mounted into the container.
- Dependency symlinks are rewritten only when their targets stay inside the project tree; symlinks escaping the project are rejected.

## 1.2.9 — File-first planner delivery (2026-09-02)

### Added
- Manual ChatGPT planner responses are delivered as downloadable `wharness-plan-<request_id>.json` files.
- Electron intercepts only matching plan downloads from the embedded ChatGPT WebContentsView.
- Downloaded plan files are limited to 2 MiB, validated as JSON, checked for `harness.execution/v1`, and must match the request id encoded in the filename.
- Plan downloads are imported automatically into the Harness Chat owning the pending request and the Inspector switches to the Plan tab after successful validation.

### Changed
- The planner prompt requires the model to serialize the plan with a real JSON encoder instead of hand-writing JSON, preventing TSX/CSS quotes from corrupting transport.
- Clipboard/manual JSON remains available only as a fallback.
- Harness Chat deletion remains local: removing a chat closes its backend session and unlinks its ChatGPT URL without deleting the remote ChatGPT conversation.

### Security
- Non-Wharness downloads remain normal downloads and are not read by the harness.
- Temporary plan files are deleted after import.
- The backend remains authoritative for request correlation, protocol validation, policy evaluation and execution.

## v1.2.8.4

- Repair malformed manual-plan quotes in both `summary` and `patch` string fields before strict v1 validation.
- Harness Chat conversations can be removed from the UI with explicit confirmation. Removing a Harness Chat deletes its local history/session/link but does not delete the remote ChatGPT conversation.
- Deleting the active/last chat automatically selects another chat or creates a fresh one.


## v1.2.8 — Per-project Protected/Unprotected execution + patch diagnostics

- Adds a project-scoped Protected/Unprotected Agent execution switch directly in the workspace UI and persists it per project.
- Protected remains the default sandbox-first flow with a separate host Apply step.
- Unprotected executes validated/policy-approved Agent plan patches, commands, and verification directly in the real project after explicit per-execution confirmation; successful runs end in `applied`.
- Keeps the interactive Editor terminal sandboxed regardless of Agent execution mode.
- Propagates the project execution preference across multiple Harness chat sessions and restores it after reopen/backend restart.
- Replaces generic `git apply --check failed` failures with Git stderr diagnostics.
- Adds conservative patch retries using `git apply --recount` and checked `--3way` when blob index metadata is present; fallback mutation runs only after its check succeeds.
- Uses the same patch strategy for Protected sandbox execution, later host Apply, and Unprotected direct host execution.

## v1.2.7 — Resilient manual JSON patch transport

- Repairs the narrow, common ChatGPT transport failure where source-code double quotes inside an otherwise valid `patch` JSON string were not escaped.
- Repair is limited to `patch` values that clearly start with a supported patch dialect and are immediately followed by the operation `command` field; strict protocol validation and policy still run afterward.
- Accepts JSON wrapped in a Markdown `json` fence for manual import.
- Returns a clearer syntax error with the approximate byte offset when malformed JSON cannot be safely repaired.
- Strengthens the manual planner contract: every source-code quote inside the JSON `patch` string must be escaped as `\"`.

## v1.2.6 — Multi-chat + ChatGPT conversation affinity

- Adds multiple Harness chats per workspace with independent local histories and backend session IDs.
- Persists the active Harness chat and restores it after reload/reopen.
- Stores one ChatGPT conversation URL per Harness chat and automatically navigates the embedded ChatGPT view when chats are switched.
- New Harness chats start from the ChatGPT home/new-chat surface and automatically bind the first concrete `/c/...` conversation created for them.
- Prevents accidental silent rebinding: if the user manually opens a different ChatGPT conversation after a link already exists, the UI asks for an explicit “Vincular esta conversa” action.
- Adds a narrowly validated Desktop IPC navigation capability that accepts only trusted HTTPS `chatgpt.com` URLs.
- Migrates the legacy single-chat local transcript into the first multi-chat conversation.

## v1.2.5 — Git bootstrap + resilient manual plan import

- Automatically initializes a Git repository at every opened project root when `.git` is absent.
- Re-checks Git before host apply.
- Creates an isolated Git baseline inside every sandbox copy so `git diff`, `git diff --check`, and other allowed read-only Git verification commands work reliably.
- Requires `git` in root `make build` dependency checks.
- Normalizes the common manual ChatGPT alias `schema` -> `protocol`, fills conservative missing command defaults, accepts wrapped verification commands, and converts only the safe `*** Add File` patch dialect to a standard unified diff.
- Keeps strict validation/policy authoritative after normalization. Unsupported patch dialects remain rejected.
- Strengthens the manual planner prompt with the exact required JSON wire shape and standard `git apply` unified-diff requirement.

## v1.2.4 — ChatGPT clipboard permission

- Allow `clipboard-sanitized-write` only for the embedded `https://chatgpt.com` origin so ChatGPT's Copy button works in Electron.
- Keep `clipboard-read` denied to remote content; response import remains an explicit trusted Wharness action.
- Add allowlist regression coverage for clipboard permission origins.

## v1.2.3 — ChatGPT stream compatibility

- Presents the isolated ChatGPT session with a Chrome-compatible UA matching Electron 44 Chromium 152.
- Clears HTTP cache at Desktop startup without removing cookies/login state.
- Adds sanitized ChatGPT load/network/HTTP diagnostics to lifecycle logs.
- Keeps the remote surface sandboxed and does not read ChatGPT DOM or response content.


## 1.2.1 — Unified build/start/stop lifecycle (2026-09-02)

### Added
- Root `make build` installs dependencies, builds backend/frontend/desktop checks, and builds the Docker runner.
- Root `make start`, `make stop`, `make restart`, `make status`, and `make logs`.
- Runtime PID tracking under `.harness/run` and combined desktop logs under `.harness/logs`.
- Compiled backend runtime preference (`dist/bin/wharness-backend`) and built frontend preview preference.
- Linux Electron ozone selection with X11/XWayland preference and Wayland Vulkan fallback.

### Fixed
- Docker runner builds no longer depend on the caller being in the repository root.
- Electron launcher no longer inherits an incompatible automatic Wayland/Vulkan combination when XWayland is available.
- Coordinator shutdown terminates only the child process groups it created.

## 1.2.0 — Wharness Desktop / ChatGPT composition (2026-09-02)

### Added
- Electron `WebContentsView` desktop shell with ChatGPT in the same native window.
- Persistent isolated ChatGPT web session.
- Native copied-file context ZIP clipboard.
- Explicit context refresh API before desktop bundle copying.
- Desktop browser controls and state telemetry limited to URL/title/loading/navigation state.
- Clipboard JSON import.
- Desktop security tests and one-command development launcher.

### Security
- Remote ChatGPT renderer has no Node integration and no Wharness preload.
- IPC is sender-checked and capability-specific.
- Context bundle URL is derived in the main process from a local backend and validated session ID.
- Remote permissions are deny-by-default except notifications.
- No ChatGPT DOM/cookie/output extraction was introduced.


## 0.2.0 — Workspace IDE / Agent (2026-09-02)

### Added
- Editor / Agent mode switch.
- Workspace recovery after frontend reload and backend restart fallback.
- Recent workspace memory and per-project local chat history.
- Safe project Explorer.
- UTF-8 text editor with Ctrl+S and SHA-256 optimistic locking.
- Persistent per-session sandbox terminal with argv execution, optional network, and reset.
- ChatGPT/OpenAI provider tab.
- Context refresh before every Agent request.
- OpenAI context attachment on continued Responses conversations, deduplicated by snapshot hash.
- File API and terminal API endpoints.
- Security tests for traversal, symlink parent/file escape, executable-mode preservation, stale writes, and terminal shell denial.

### Changed
- Manual Bridge is now presented inside the ChatGPT tab.
- Agent planner message wording now distinguishes manual provider from automatic OpenAI provider.
- Frontend package version is 0.2.0.

### Deliberately excluded
- Consumer ChatGPT web iframe login inspection, prompt injection into the ChatGPT DOM, scraping, and automated Output extraction.

## 1.2.2 - External OAuth routing

- Route Google/Microsoft/Apple OAuth popups from the embedded ChatGPT surface to the system browser.
- Add an explicit Open in browser control to the ChatGPT toolbar.
- Keep Chrome/Electron cookie stores isolated; no browser-profile or cookie import is performed.

## v1.2.10 — Chat affinity canonicalization + file-first hardening

- Canonicaliza URLs `/c/<id>` antes de comparar o chat atual com o chat vinculado, ignorando trailing slash, query, fragment e subdomínio ChatGPT.
- O aviso “Está a visualizar outra conversa” só aparece depois da navegação estabilizar e apenas quando os IDs de conversa realmente diferem.
- Reforça o planner manual para criar um ficheiro real `wharness-plan-<request_id>.json` com a ferramenta de geração de ficheiros/Python e proíbe fallback inline.
- O importador manual passa a reparar também patches unified diff que começam diretamente em `--- a/...`, além de `diff --git`.

## v1.2.17 — Project Explorer bootstrap + smart context (2026-09-03)

### Added
- Native Desktop folder explorer for opening projects and selecting create/clone destinations.
- New-project creation with automatic Git initialization.
- Git clone bootstrap using `--recurse-submodules`, including nested submodules.
- Per-project `whaness.yml`, created automatically whenever missing.
- Workspace project-settings dialog for context auto-pruning, include/exclude patterns, and per-file size limits.
- Context recognition for IDE metadata, dependency caches, generated build/test output, temp files, binary/archive/media assets, and generated Wharness context snapshots.

### Security
- Folder selection is a sender-checked trusted-renderer IPC unavailable to remote ChatGPT content.
- Project context settings can narrow context but cannot override mandatory secret, symlink, VCS, or protected-path exclusions.
- Clone rejects option-like/unsafe destinations, never overwrites an existing directory, suppresses interactive credential prompts, and redacts the supplied repository string from Git errors.

<!-- whx-conflict-resolution: candidate residency changelog entry intentionally omitted; host changelog retained -->
