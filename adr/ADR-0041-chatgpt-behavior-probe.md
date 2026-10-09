# ADR-0041 — Dev-only ChatGPT behavior probe

## Status

Accepted. Extends ADR-0027 (ChatGPT account automation provider), ADR-0037
(trusted-input account automation) and ADR-0038 (pooled chat agents and behavior
documents).

## Context

Account automation depends on a selector and label vocabulary that ChatGPT owns
and changes without notice. When that vocabulary goes stale, every operation
fails at the same step with a state name — `action-unavailable`,
`project-dialog-unavailable`, `create-project-unavailable` — that says a control
was not found but nothing about what the page actually offers instead.

That gap is measurable, not hypothetical. In this instance's own data, 43
`ORGANIZE_CHAT` tasks failed and not one produced an actionable signal. The
dominant mode (36 of them) turned out to be a hidden slot stranded at a 0×0
layout viewport — a Wharnex defect, not a stale selector — and the two were
indistinguishable from the outside because both surface as "the control was not
located". The remaining failures survive that fix and are genuine vocabulary
staleness, with still nothing to correct them against.

ADR-0037 established the correct method for this class of problem: confirm the
behaviour against the live ChatGPT DOM rather than infer it from logs. Doing so
today means an operator reading the DOM by hand, which is slow, unrepeatable and
not available to the maintenance jobs that are actually failing.

The obvious shape — "let the trusted renderer evaluate JavaScript in the ChatGPT
view" — is exactly what `SoT/SECURITY_MODEL.md` forbids, and correctly so: it
would hand arbitrary DOM enumeration and response-prose access to any code that
can reach the preload.

## Decision

Wharnex exposes a **dev-only behavior probe**: a narrow, named IPC capability
that measures the controls the account automation already depends on and returns
bounded structural metadata.

It is not a JavaScript evaluation capability. Four properties define it:

1. **Closed vocabulary.** The caller names a control from a fixed enum
   (`sidebar-toggle`, `conversation-menu`, `menu-items`, `project-anchors`,
   `project-dialog`, `delete-dialog`, `reasoning-effort`, `composer-transport`, `model-picker`). An unrecognized name is rejected before
   anything is built. Adding a control is a reviewed change, exactly like
   admitting a planner reason code.

2. **No caller string reaches the page.** Every probe script is assembled in the
   main process from constants. The caller supplies no selector, no expression
   and no interpolated value, so the capability has no injection surface.

3. **Bounded structural output.** Results carry counts, the renderer viewport,
   and the structural identity of containers (`tag`, `role`, `data-testid`). For
   menu, dialog and composer reasoning-effort controls they additionally carry the exact control labels the
   account automation is already permitted to read under `AGENTS.md` §7 — app
   chrome, bounded to 16 entries of 120 characters. The main process re-bounds
   every result before it crosses IPC, so a page returning something unexpected
   cannot widen what is exposed. Assistant prose, conversation content, project
   names, hrefs, cookies, storage and headers never enter a probe result.

4. **Off by default.** The capability is inert unless Wharnex is started with
   `WHARNESS_BEHAVIOR_PROBE=1`, so it is a deliberate diagnostic session rather
   than a permanent surface. It additionally requires a trusted sender, an owned
   chat surface, and a trusted `chatgpt.com` origin.

The probe grants the layout viewport before measuring, because a slot stranded
at 0×0 would otherwise report every control as absent — the precise confusion
this ADR exists to remove.

The 2026-10-08 transport maintenance adds `composer-transport`: counts of
composer/turn/streaming wrappers and at most 16 composer control identities,
including popup and disabled attributes. It reads no conversation text. When
the diagnostic flag is enabled, an owned idle transport may sample this and
`reasoning-effort` once per 30 seconds; only changed bounded shapes are logged.
The existing named response-completion operation may contribute structural
booleans and counts for the armed request. Sampling stays passive, never runs
during prompt preparation, and cannot fail or change liveness classification.

## Consequences

- A stale selector or label set can be corrected from evidence rather than
  guessed at, and the correction can be verified by re-running the probe.
- The probe reports what the page offers, never what it says. It cannot be used
  to read a response, and it cannot be widened without editing the enum and the
  constant scripts together, both of which are reviewed changes.
- It is diagnostic only. It never clicks, never navigates, never mutates the
  account, and is not reachable from a model plan or from remote ChatGPT
  content.
- Because it is disabled by default, an ordinary operator session is unchanged
  and carries no additional surface.

The 2026-10-09 `model-picker` probe is passive: it reports only the uniquely identified model trigger, its explicitly linked menu and bounded model-control labels/selected/disabled flags. A collapsed menu stays collapsed and yields no catalog. The production composer inventory and selection operations are separate human actions; the probe never activates them.

The request-bound `expected-download` observation is a production transport diagnostic, separate from this dev-only control catalog. It reuses the allowlisted download selection scan with the canonical filename from the main-process armed expectation and can return a passive, bounded structural result. The trusted renderer never supplies that filename or a script/selector. Normal polling records at most one changed result or one unchanged result per 30 seconds; assistant text, filenames other than the armed expectation and URLs never enter its diagnostic output. This adds no generic evaluation capability and does not change the dev-only probe contract above.


### Expected response artifact controls — 2026-10-09

The production expected-download diagnostic also reports bounded owned resource/control naming-contract matches and marker ancestor shapes. It does not add an arbitrary behavior-probe control or renderer-owned filename. Generated prose, hrefs and actual observed labels remain absent from diagnostic output; resource filename classification is passive and cannot authorize a download.

The final complementary production resource diagnostic is closed to role-link, download, file-name attributes and resource-test-id controls. Its output contains bounded shapes, counts, visibility/capture-membership/naming booleans and numeric viewport/scroll dimensions. No textContent, href, input, scrolling, navigation or activation is performed. This addresses controls outside the shipped capture scan without changing that scan or its download decision.

### Popup de modelos em dois níveis — 2026-10-09

A operação nomeada de inventário pode devolver diagnóstico passivo do seu popup owned quando este ainda não expõe opções reconhecidas. A evidência visual do utilizador mostra painel de esforço seguido de submenu de modelos; a instrumentação distingue contagens/roles/ligações ARIA e geometria, sem texto, cliques adicionais nem catálogo fixo. O script continua constante e a normalização main-process limita 64 controlos inspecionados e 16 formas devolvidas.
