# ADR-0099 — Cohesive workbench experience

Status: Accepted by explicit operator request, 2026-10-15.

## Context

The operator requests an implemented redesign of the Desktop workbench, with
clear navigation, consistent components, progressive detail and full retention
of existing technical capabilities. Independent headers, dense composer controls
and two competing default launchers make the present product difficult to scan.

## Decision

`SoT/WORKBENCH_DESIGN.md` owns the audited information architecture and shared
scale. One default left launcher groups development, intelligence and tools.
The right panel remains available for auxiliary work. Existing customized rails,
pinning and drag ordering are loaded unchanged. Reset is an explicit action.

The shell prioritizes project identity and central work. A searchable command
palette invokes named existing frontend actions. File and project search use the
existing guarded APIs. The parent shell can request only that palette, with
same-origin and owning-parent validation; it gains no general command channel.

Shared Tailwind primitives own controls, fields, headings, semantic states,
empty states and form popovers. Composer configuration, context and execution
options are separated progressively. Model, permissions, attachment, queue and
send actions retain their original handlers and busy restrictions. Native Codex
account inspection distinguishes pending, stored and actually connected states.

Settings use stable categories and a responsive administration surface. Context
drafts remain owned until saving succeeds or discarding is explicitly confirmed.
Git reviews share a selectable file rail and real Monaco comparisons, with a
stable window through preparation/review and a separate exact confirmation.
Complex windows reuse actual minimize/maximize/resize/close capabilities inside
one heading. Simple confirmations keep their existing dialog boundary.

Layout focus hides surfaces without closing their resources or overwriting
saved geometry. Narrow windows overlay auxiliary drawers and keep the central
activity usable. Human terminal lifecycle, sessions and input remain unchanged.

The bottom workbench composes Terminal, Problems and Execution Output without
unmounting the terminal when another tool is selected. Its selection is saved
per project; a human terminal activation/run request selects Terminal. Output
reuses durable execution history merged with live events rather than depending
on the current snapshot. No model gains access to the human PTY.

The browser monitor adopts the shared tokens and controls, contextual columns,
read-only location, progressive diagnostics and a reversible wider browser view.
These are presentation changes over the existing instance ownership. Native
views remain beside policy confirmations. No navigation or reload IPC is added.
Settings pages share headings, groups, fields and save actions; provider-specific
credential editors preserve their existing contracts. Failed initial loading
in language and connection pages offers explicit retry instead of endless progress.

Document ordering adds local drag and keyboard gestures without altering drafts
or saving files. Existing workspace memory persists the resulting document order.

## Migration and compatibility

No database, protocol, authorization, authentication, PTY, execution or IPC
capability migration is required. Existing persisted layout keys and drawer IDs
remain compatibility boundaries. The shipped control-image tag is retained only
as the browser-test image's default build base. New names use Wharnex.

The operator authorizes changed appearance only for redesigned surfaces, under
FRONTEND_STYLING §6. Dedicated legacy rules for migrated owners are deleted.
Shared element defaults, resource strip geometry, window drag/dock mechanics and
third-party editor rules remain named cascade exceptions: removing them would
alter unrelated surfaces. Important token utilities override them at the new
component boundary. No replacement root stylesheet or third-party UI library is
introduced. Lazy domain boundaries remain lazy.

## Validation and bounded refactoring

Tests cover primitive focus, command selection, saved layout, composer options,
context drafts, honest account state, queue controls and Git confirmation/window
continuity. Chromium exercises real React and Monaco surfaces with local fixture
data in light/dark themes, narrow windows and scaled text. No account credentials
or live remote-browser pixels are used.

The initial dirty working tree is the comparison baseline. Existing failures are
reported separately; assertions are not relaxed to make unrelated failures pass.
The implementation extracts touched concerns from oversized components, removes
obsolete styling and records remaining legacy owners and actual gate results in
`docs/frontend/workbench-redesign-2026-10-15.md`.

Presentation tests that formerly read dedicated CSS now inspect the migrated
component owner and its token/geometry contract. Existing mutation, confirmation,
transport, permission and persistence assertions remain enforced. Publication
tests wait for the actual asynchronous review content inside its stable window.
The browser suite builds a private production fixture to use Monaco's shipped
workers, keeping development-server transformation out of the comparison oracle.

Validation: frontend typecheck and production build passed. The full frontend
suite ran 1,400 tests: 1,337 passed and the same 63 baseline tests failed in the
same 42 files, with no additional failures. This adds 41 tests. The post-extraction
focused suite passed 52 tests, and layout/document/operational composition passed
nine focused tests. Chromium passed 12 production-fixture scenarios. Lint retains
only the same three pre-existing Drawio errors; the domain gate retains only its
three pre-existing backend directory violations. All 116 newly introduced source
and test files are at most 175 lines and their domains stay within 20 files.
