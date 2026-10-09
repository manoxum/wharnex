# Exact response ZIP capture diagnosis — 2026-10-09

The test conversation's create response downloaded at 09:22 after the user clicked
it. Its validated bundle, execution and host result remain valid, but that capture
does not demonstrate automatic download. No automatic `download-triggered` entry
was recorded for its correction between 09:04 and 09:22. The user subsequently
reported that the delete response for `req_20261009T092629_a19fba3bbfc8484b` was
ready and still undetected.

The existing download scan and selection decision now share a named
`downloads/affordances` module. The Supervisor requests a structured result from
the same scan it already performs. Workers and utility callers retain the shipped
string result. Selectors, activation and candidate precedence are unchanged.

`[chatgpt-bundle-probe]` records request/chat correlation, the main-owned armed
filename, a closed skip reason, selection state, counts and at most sixteen
structural control shapes. Metadata used internally for exact filename matching
is never returned: no answer text, href, unrelated content or authentication
state enters this diagnostic. Identical snapshots are emitted at most once per
thirty seconds; changed snapshots appear immediately. Logging failure cannot
interrupt supervision.

The output distinguishes an ownership or preparation guard from no candidate,
ambiguous candidates and a generic latest-response control blocked by exact-only
mode. It supplies evidence for a later targeted correction rather than changing
download controls speculatively. Restart adoption remains passive and may not
upload, submit a continuation or infer completion from prose.

Validation: full Desktop `npm run build`, 1090/1090 tests; focused source guards,
passive diagnostic, compatibility and structured-negative-result regressions;
domain placement/size inspection and `git diff --check`. Live post-rollout
automatic capture remains to be established by the coordinating session.

Live 09:44 evidence: original DRCAE response was automatically captured from an exact filename control; fixture delete had zero exact/actionable controls with no attention/ownership block. Added passive owned resource metadata contract classification and bounded marker ancestor shapes to distinguish missing/wrong response names from marker scope. No activation rule changed. A regression verifies a failing resource diagnostic cannot prevent an exact download. Additional full gate recorded separately in desktop-resource-diagnostic-build-final-20261009.log.
