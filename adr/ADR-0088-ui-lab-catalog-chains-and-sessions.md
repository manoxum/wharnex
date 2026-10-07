# ADR-0088 — UI Lab: incremental catalog, operator-designed tests, test chains and persisted browser sessions

Status: Accepted
Date: 2026-10-02

## Context

UI Lab asked GPT for a complete test catalog on every synchronization and
replaced the stored one. GPT never saw what already existed, so it could not
tell which tests were still missing; tests were thin (title and goal only);
every test was expected to carry a role even when the page was public; and
each run started from an empty browser, so a test such as "create an item" had
no way to express that it needs a signed-in session, and nothing could avoid
repeating a login before every authenticated test.

## Decision

1. **Discovery v2 is incremental.** `wharnex.ui-test-discovery-input/v2`
   carries, besides the project context, `catalog/current.json`
   (`wharnex.ui-test-catalog/v1`): every environment with its local
   configuration state (URL, profiles and whether each is configured) and
   every test with its full definition, provenance and latest outcome. It
   never carries credentials or session material. The manifest binds the
   catalog's SHA-256. The answer (`wharnex.ui-test-discovery/v2`) returns only
   new or revised tests, new or changed environments, the discovered tests
   that are obsolete, and a short Portuguese summary.
2. **The engine merges.** Omitted tests are kept. Local configuration always
   survives. A synchronization never overwrites or retires a `user` test, and
   never retires a test another test still depends on. The merged catalog is
   validated as a whole before anything is saved; field-level rules apply to
   the incoming answer only, so a catalog stored under older rules never
   blocks a later synchronization.
3. **Detailed definitions.** A test declares `access` (`public` |
   `authenticated`), category, priority, preconditions, an ordered strategy of
   `{action, expected}` steps, the expected result, test data, tags and
   `depends_on`. A public test names no profile and may not inherit one.
4. **Operator-designed tests ("Novo").** The same v2 exchange with task
   `design_ui_test` adds the operator's brief as `brief/request.md`. The
   answer must add at least one test and may retire none. Tests it writes
   are marked `source=user` and keep the brief.
5. **Test chains.** `depends_on` forms an acyclic graph inside one
   environment, at most 8 direct prerequisites per test, and one chain never
   mixes two profiles. A dependent inherits its chain's profile. Running a
   test runs its prerequisites first, in topological order, in the same
   browser. A failed prerequisite marks the remaining tests `blocked`.
   Selecting a prerequisite together with its dependent runs it inside the
   dependent's chain, and that run may not skip it.
6. **Persisted browser sessions.** After each passed test, the Desktop worker
   captures the page URL and the environment origin's cookies and web storage
   from an isolated, in-memory, per-task browser partition. The backend
   validates that state against the origin, seals it with the local
   credential key and stores it in PostgreSQL table `wharnex_ui_test_sessions`
   (one row per project, environment and test, following
   `SoT/DATABASE_IDENTIFIERS.md`), for 12 hours. A snapshot records which
   tests its state covers and each one's definition digest. A later run
   resumes from the deepest prerequisite whose snapshot is unexpired, belongs
   to the same origin and profile, covers every earlier prerequisite, and
   whose covered definitions are unchanged. Restoring re-checks all of this.
   When the executor finds the restored page signed out, it reports
   `session_invalid`; the snapshot is deleted and the full chain replays once
   from a clean browser. Changing an environment URL drops that environment's
   sessions; replacing a profile's credentials drops that profile's sessions.

## Consequences

- Synchronization cost no longer grows with re-describing known tests, and
  operator work is never lost to a resync.
- Authenticated suites sign in once per 12 hours instead of once per test.
- Session state is a secret: it is never logged, never shown to GPT or to
  the renderer (the UI receives only a non-secret summary), and reaches the
  Desktop only through the task-bound restore endpoint, with `no-store`.
- v1 discovery requests already in flight remain parseable and are merged with
  replace semantics; v1 run payloads still execute as single-test chains. New
  work is always requested in v2.
- Every GPT exchange of a run is a bundle (amended 2026-10-03): each controller
  iteration and the user guide are engine-built request ZIPs with exact,
  engine-validated response ZIPs, as `adr/ADR-0087` requires. The Desktop no
  longer reads assistant prose in UI Lab.

## Amendments from the first full run on a real project (2026-10-03)

Running the whole catalog of a real application (drcae-deploy) exposed limits
the unit-level design did not:

- **Upload budget.** ChatGPT limits file uploads per account; one exchange per
  browser action exhausted it after ~85 uploads. A step answer may now plan a
  sequence of up to 15 actions that the executor runs without returning, and
  the user-guide exchange doubles as the visual review. A spent allowance
  defers the task as a free 20-minute observation instead of failing it.
- **Captions.** Every step answer carries a mandatory `screen_caption` for the
  capture it saw, and the guide answer captions every capture it was sent,
  with a visual `verdict` that can fail a run whose actions only looked
  successful.
- **Selectors and recovery.** Each step carries the page's visible interactive
  elements with selectors proven unique; a failed action becomes feedback for
  the next plan; an answer the backend refuses is asked again once with the
  refusal attached; `fill_credential` is refused when no credentials exist.
- **Reference data.** Environments carry operator `notes` (non-secret real
  identifiers) that GPT uses instead of inventing data.
- **Scope.** Planning covers only what a desktop browser can complete;
  native-shell, kiosk, paired-device and hardware environments are retired
  with `obsolete_environment_ids`.
- **Capacity and durability.** At most 3 UI test runs execute at once (each
  holds two Chromium surfaces for minutes); issued exchanges persist across
  backend restarts; runs whose task ended without reporting are closed with
  the task's reason.
- **Manual.** Guides share fixed sections and are read as one manual per
  environment.

The guide exchange became a structured document rendered by the engine, with
measured markers, focused crops, HTML/PDF/Markdown views and a coverage review
of the test plan: see `adr/ADR-0094`.

## Amendment: truthful activity and temporary-hold recovery (2026-10-06)

Queuing a run records `queued`, rather than marking the catalog `running`.
The UI document overlays the durable task state on retained unfinished runs:
`PENDING` and `LEASED` are queued; `WAITING` and future `not_before` are waiting;
`RUNNING` is active only while an owner has an unexpired lease. Terminal or
missing tasks close unfinished runs with the existing failure reason. An older
completion cannot replace the catalog outcome of a newer run. Legacy catalog
entries labelled running without a retained run return to ready, without
inventing an execution result. This is a compatible correction: status fields
remain strings, task identity and execution protocols are unchanged.

A temporary operator database trigger, `wharnex_temp_hold_ui_tests`, installed
before ADR-0093 forced every pending/waiting UI task's `not_before` to 2100.
Releasing the new task hold could not undo that trigger. The bounded one-time
recovery in `scripts/ui-testing/recover-legacy-suspension.sql` removes only that
named trigger after checking its definition, then releases only marked legacy
suspensions and pending UI tasks with the matching sentinel date. It preserves
attempts, task identity, payloads and outcomes. Ordinary cooldowns and terminal
work are untouched; the durable task holds continue to govern eligibility.
The script's PostgreSQL fixture includes the actual trigger behavior and proves
that the recovery does not release unrelated work. Apply it in a transaction.
