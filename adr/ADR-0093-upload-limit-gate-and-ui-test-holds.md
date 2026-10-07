# ADR-0093 — ChatGPT upload-limit gate, per-type task holds and UI tests on persistent Workers

Status: Accepted
Date: 2026-10-06

## Context

ChatGPT now caps file uploads per account over a rolling window. When the cap
is spent, the composer's "+" menu shows the upload item disabled ("wait about
two hours"). The native file selection is still accepted, but no upload
request ever leaves the page.

Wharnex read that as a transient transport fault. Every upload that never
started was retried five times locally, by every pool, and then charged to the
task's attempt budget. Measured over 30 hours (2026-10-05/06, drcae-deploy):

- 333 confirmed uploads and 1290 "did not start" retries;
- `UI_TEST_RUN` alone made 327 of the 333 uploads (98%) and 1210 of the
  retries. Each run made one upload per GPT exchange on its own ephemeral
  browser, outside the persistent Workers' pacing, suspension and accounting;
- the pattern repeated every few hours: about 60–85 successful uploads, then
  hours of refusals;
- an ordinary Agent chat (`BOT_WRITE`) then failed four of its six attempts on
  the same limit. Switching the ChatGPT account let the same request upload at
  once, which confirmed that the selectors and upload transport were sound.

UI Lab also had no way to stop its own work: halting the runs required editing
the queue in the database. More generally, only the persistent Workers' task
types could be suspended, from a Desktop-local selection. Supervisor and
ephemeral types were outside any policy. The Policies tab summarised the
state as "9 tipos suspensos · aguardam liberação manual" without saying which
types were held, which were cooling down, or how to release one of them.

## Decision

1. **Durable automation holds.** The backend owns the PostgreSQL table
   `wharnex_automation_holds`, which follows `SoT/DATABASE_IDENTIFIERS.md`; each
   hold's name is its `sid`. The closed set has two kinds of hold:
   - one hold per browser task type, `task:<TYPE>`. The catalog is derived
     from the queue's own task-type table (`session.ChatAgentTaskCatalog`), so
     a new type is under policy the moment the queue accepts it;
   - `chatgpt_upload`, the account upload limit described below.

   A hold does not change task state. The claim route
   (`internal/transport/httpapi/taskclaim`) adds every held type to the claim's
   excluded types, for every pool, before an attempt is charged. If the holds
   cannot be read, the claim fails closed. Account-maintenance and title types
   are held by default until the operator first decides otherwise; that
   default used to be Desktop-local.
2. **Per-type policy, everywhere.** `GET /api/automation-holds` publishes each
   type's effective state, computed in one place
   (`automationhold.TaskPolicies`):
   - `suspended`, by the operator or by default;
   - `cooldown`, from the Worker rate-limit pause (Worker-pool types only) or
     the upload limit (types that attach a request archive), each with its
     deadline;
   - otherwise `active`.

   `PUT /api/automation-holds/{name}` raises or releases a hold. The Policies
   tab of the Agents drawer and the browser monitor list every category and
   type with that state and **Suspender**/**Retomar** per type and per
   category. Resuming a cooldown releases an account-wide pause, so the
   operator confirms it first: with a themed dialog in the drawer, and inline
   in the monitor. UI Lab's **Suspender testes UI** raises
   `task:UI_TEST_DISCOVER` and `task:UI_TEST_RUN`.

   The Desktop's whole-pool Worker switch stays local and Worker-only,
   because the tray uses it. Its former per-type selection is migrated to
   task holds once and then retired.
3. **Upload-limit gate (Desktop).** One gate per Desktop process covers the
   account and all of its pools. It is designed as follows:
   - **Evidence.** An upload counts as evidence when it did not start on a
     ready composer. Two such outcomes in a row from any surface, with no
     confirmed upload between them, open the gate. A single one opens it if a
     structural probe shows the composer's upload controls are all disabled.
     The probe reads only `disabled`/`aria-disabled` state and counts, never
     labels or text.
   - **While open.** Every upload-bound action defers before file selection
     with `ChatGPTUploadLimitDeferral`. That error has `retryUpload=false` and
     `freeDeferral=true`. The scheduler settles any thrown free deferral as a
     `waiting` observation until the gate's deadline, so the attempt is
     returned.
   - **Windows and probe.** The windows are 10, 20, 40, 80 and then 120
     minutes, which matches the provider's own two-hour horizon. When a window
     lapses, exactly one upload is admitted as the probe. If it succeeds, the
     gate closes. If it does not start, the gate reopens at the next window.
   - **Closing.** A confirmed upload anywhere closes the gate. So do a
     completed sign-in, an imported or cleared browser session (the account
     may have changed) and an operator release.
   - **Persistence.** The gate is persisted as the `chatgpt_upload` hold, so a
     Desktop restart keeps the window. The runtime refresh feeds the hold back
     into the gate. An inactive record written after the gate last changed is
     an operator release.
4. **UI tests run on the persistent Workers.** `UI_TEST_DISCOVER` and
   `UI_TEST_RUN` leave the ephemeral (`translator`) partition and become
   ordinary Worker types. Their ChatGPT exchanges now go through the global
   Worker pacing gate, the manual Worker suspension by type, the rate-limit
   suspension and the upload-limit gate. The browser under test remains an
   isolated, in-memory, per-task `BrowserWindow`, and the ephemeral surface is
   used only to navigate the application being tested. At most one UI test run
   executes at a time (`UI_TEST_RUN_CONCURRENCY = 1`). The Worker claim
   excludes `UI_TEST_RUN` at that cap, and the executor refuses an over-cap
   claim as a free observation.

## Consequences

- When the account limit is reached, the Desktop stops after about two
  uploads that never started. It does not make five retries per task in every
  pool, and no task spends attempts on the limit.
- UI Lab can no longer drain the upload budget in parallel with Agent chats.
  Its exchanges are paced, counted and suspendable like any other Worker work.
  It also yields Workers to Orchestrator and lifecycle work.
- The account cannot be identified without reading authentication state, which
  is forbidden. A switched account is therefore recognised only through the
  sign-in, session-import and session-clear hooks, a confirmed probe, or the
  operator's **Libertar limite**.
- The UI Lab regex fallback ("did not start the file upload" → 20 minutes) is
  replaced by the typed deferral.
- The structural signature of the disabled upload control is not yet
  confirmed live. Each "did not start" logs
  `[chatgpt-upload-limit] not-started … inputs=a/b triggers=c/d`, so that
  `CHATGPT_AUTOMATION_MAINTENANCE.md` can pin the map at the next natural
  occurrence. Until then, the behavioural rule (two consecutive) is the one
  that decides.
