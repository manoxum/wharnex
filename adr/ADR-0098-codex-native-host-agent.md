# ADR-0098 — Codex Native host agent and interactive questions

Status: Accepted by explicit operator request, 2026-10-12.

The operator requests a native local Codex agent, not a second provider for
Wharnex's bundle planner. This supersedes ADR-0097's planner-only contract for
new Codex requests and records the corresponding explicit AGENTS.md exception.
ChatGPT Scraper remains the default and preserves its existing workflow.

New Codex requests bypass backend planner submission. They contain the exact
user prompt plus explicit attachment/artifact paths and selected file references.
Attachments are materialized privately as individual files, never ZIPs. Codex
starts in the actual project directory with the chosen native permission level
and normal native tool/configuration ecosystem. Full access uses
danger-full-access/never; Ask for approval uses workspace-write/on-request with
the user reviewer; Approve for me uses the same sandbox with Codex auto_review. Operating-system privileges and
Codex administrator requirements still apply. Wharnex does not create a copied
workspace, impose archive-only tools, send context snapshots or expect a ZIP.

Native state has its own namespace so old planner instructions cannot contaminate
new native conversations. Existing pending planner requests may be cancelled or
their already-created results delivered, but are not silently resubmitted as
native host work. Project ownership and trusted-origin IPC remain mandatory.

The owning Engine presents streaming messages, command/file-change activity,
runtime questions and approvals. Replies use typed, exact-request operations,
with one response per pending server request; missing answers do not auto-submit.
Cancellation, request resolution, disconnect and restart retire pending replies.
Secret replies are neither logged nor included in durable history/artifacts.

Native state snapshots are accompanied by an append-only, redacted local ledger.
Input and settled transcript artifacts are persisted through the existing backend
artifact port so chat archives retain native work. The transcript is a native
agent record, never a fabricated execution plan or verification result. Failure
to archive is surfaced separately and never reruns a native turn.

Compatibility: old chats default to ChatGPT, existing drawer IDs remain valid,
and no database migration is needed. The UI explicitly identifies native host
access. New UI styling uses existing Tailwind tokens.

Reference: https://learn.chatgpt.com/docs/app-server.

Operator continuation, 2026-10-12: native interrupted/quota-limited work is
resumed only by an explicit Engine action, in the stored Codex thread. No
restart or quota event replays the original prompt or automatically executes.
Named account profiles use separate runtime-owned CODEX_HOME directories and
official login APIs; credentials are never read, copied or exposed by Wharnex.
Changing the selected account does not move in-flight work. A manual resume may
transfer only that owned thread's native rollout to another selected profile,
after verifying the former runtime has no active turn. Context exhaustion is
distinct from account quota exhaustion and must not suggest account switching.
Auto Evolution awareness comes from the backend's actual session flag; native
Codex receives only a short mode annotation alongside the user's input.

Implementation/refactoring scope: native input, execution events, interaction
resolvers, journal, account profiles, native session handoff and recovery each
have narrow modules. Frontend account, activity, question, recovery and composer
controls use Tailwind and existing workbench primitives. Existing composer and
ChatGPT chrome keep ADR-0097's explicit appearance-preserving styling exception;
no legacy CSS rules were added. All new implementation/test files stay below
200 lines and all new directories below 20 files. App and ChatPanel shrink
through the extracted provider concerns. Legacy archive adapters remain only
for already pending requests; their tests and strict validator are preserved.

Verification, 2026-10-12:

- Desktop `npm run check`: 1,174 tests passed. Real pinned app-server fixtures
  verify host file mutation, interactive questions, stored-thread continuation
  after restart and transfer between isolated account profiles. Fixtures use a
  local deterministic Responses server, no account credentials or paid calls.
- Frontend typecheck and production build passed. Focused engine/composer,
  interaction, account, recovery and existing transport tests: 36 passed.
- Playwright: five cases passed, covering dark/light themes, responsive width,
  streamed activity, interactive answers, runtime efforts/permissions, quota
  continuation, account switching and Auto Evolution indication. Screenshots
  were visually inspected.
- Full frontend comparisons retain existing baseline failures. The final
  broad run produced 61 failed/1,267 passed and the same four
  `closeInteraction` mock errors as unmodified HEAD. One unchanged execution
  status test timed out under the full run and passed on isolated rerun. A login
  failure case exercised the account module cached before its correction while
  that full run was already in flight; the corrected module passes the final
  focused suite and its separate rerun. Assertions were not relaxed. Global
  lint retains the same three untouched Drawio errors, and domain-layout
  retains the same two oversized backend directories.

Compatibility/limits: no database migration, host CLI installation or VS Code
extension host is required. Wharnex renders its own client over the official
app-server; it does not embed a VS Code webview. Accounts require explicit user
login, with at most eight named profiles; switching a profile alone executes
no continuation. Only Wharnex-owned threads are visible or transferable.

Recovery compatibility correction, 2026-10-12: a native quota failure saved
before recovery fields existed remained `attention` with no `resumeAvailable`,
so neither rendering nor resuming offered continuation. Native attention state
now owns recovery eligibility, old snapshots acquire metadata at load, and
the client tolerates missing flags. A non-retrying native error also exposes
recovery before a subsequent completion notification. The recovery action is
outside the scrolling transcript; restoring it never submits automatically.
Older native bindings also lacked account identity and the rollout path. The
default account now stays the default instead of attempting a self-handoff;
the runtime's owned thread/read supplies the path when continuation needs it.
Pending native notifications are drained before a new continuation is prepared.

Correction verification: the saved-state and renderer tests reproduced the
missing recovery option before the fix. Desktop checks passed 1,176 tests;
34 Codex frontend tests, typecheck, production build and all six Playwright
cases passed, including old snapshots, quota errors and a long transcript at
380px width. The screenshot was visually inspected. The existing Drawio lint
errors and two backend domain-layout violations remain unchanged.

The actual saved native binding was inspected using lifecycle metadata only:
`attention`, missing recovery/account/path fields and the native usage-limit
error. A read-only projection of that same binding now reports recoverable
quota state with its original thread preserved. No live request was submitted
or saved user state edited during diagnosis.

Final correction suite: 1,271 frontend tests passed, 59 failed and the same
four pre-existing closeInteraction mock errors remain. Failure identities were
compared with the unmodified baseline; no additional failure was introduced.

Compact continuation correction, 2026-10-12: the operator replaces the recovery
form with one accessible play icon in the footer. Clicking supplies the native
continuation instruction and uses the selected account. A real refusal was
traced to an active writer owned by another Codex client. Preflight resumes
the original owned thread before request mutation, reports this specific
conflict without provider-body logging, records its classified failure in the
durable native ledger, and retains the original request on
failure. Writer locks are never removed and other clients are never killed.

Compact correction verification: the real-runtime regression first reproduced
the writer refusal, then passed with preserved request identity. The same
isolated runtime test verifies continuation after restart, profile transfer
and play without supplied instructions, using a local response fixture.
Desktop checks pass 1,178 tests; 35 Codex frontend tests, typecheck, production
build and six Playwright cases pass. Cold Vite startup under concurrent suite
load initially timed out on account visibility; the unchanged assertions pass
with the server already running. Narrow-view screenshots were inspected and
the icon's rendered width is checked. Refactoring kept all 99 Codex domain
implementation/test files below 200 lines and every directory below 21 files.

The final frontend verification covered all 313 test files across batches:
1,272 tests passed and the same 59 pre-existing failures remain. The broad
process was terminated after 279 completed files; the remaining 34 files all
passed. Four files with additional failures during concurrent load were
repeated unchanged; all remaining failure identities match the recorded
unmodified baseline. Drawio lint and backend domain-layout failures remain.

Native Git completion (operator request, 2026-10-15): successful native changes
now have engine-owned diff/version/commit bookkeeping. The initial Git HEAD,
dirty paths and bounded canonical VERSION are captured before the turn. Only
runtime-declared changed paths may enter the commit; pre-existing changes,
concurrent native turns, moved HEAD, symlinks and secret-like paths fail closed.
Native manual continuation carries the original baseline and changed paths.
The current backend Git mode decides automatic versus manual commit; Auto
Evolution retains the backend's fixed automatic mode. A native change advances
one patch component in vA.B.C.D, with a missing version starting at v0.0.0.1.
Advice, failed turns and ineligible changes do not advance the version. A failed
commit restores VERSION and its selected staging without removing worktree
changes. Automatic metadata commits disable project Git hooks and signing.

The final result travels in the redacted native ledger and per-request message
metadata, so later turns and renderer hydration preserve its diffs. Chat reuses
the existing changed-file card and Monaco inspector, explicitly labelled native
and without Protected verification, Apply or revert. The Engine also shows the
finalization activity. The shared card's existing CSS remains an explicit
appearance-preserving exception; new native UI uses Tailwind. No protocol,
database or archive migration is required. Old turns without a captured baseline
are not automatically committed. Shell-only mutations require manual Git review.

Validation: native Git fixtures cover automatic/manual completion, new files,
missing VERSION, rollback, hooks, previous edits, changed HEAD, unsafe paths,
overlapping turns and continuation. Focused frontend tests pass, including the
shared card and hydration. Two Playwright cases pass at 380px in light/dark;
the screenshot was inspected. Typecheck and production build pass. Full frontend:
1,271 passed/61 failed, compared with 1,267 passed/64 failed in unmodified HEAD,
with the same four mock errors. The one additional timeout passes unchanged in
both isolated reruns. Lint has the same three Drawio errors; domain-layout has
the same two backend violations. Desktop's launcher shell-handoff failure also
reproduces in unmodified HEAD. Existing failing assertions were not changed.
