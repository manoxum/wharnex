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

Compound follow-up filenames may contain an earlier request followed by the current request. Diagnostic chat classification therefore takes the prefix before the first `_req_` and request classification takes the suffix after the last `_req_`. A regression confirms an earlier same-chat file and a current file whose name lacks the earlier chain are distinguished; exact activation still requires the whole armed filename.

A final complement measures role-link/download/file-name/resource-test-id controls absent from the original capture scan, using control attributes only. It records viewport/root/main scroll numbers, visibility and existing-scan membership with filename/ZIP booleans. At most128controls are inspected and16shapes returned. Tests forbid textContent/href/activation/scrolling and prove that even an exact filename in the complementary inventory leaves the original capture decision empty. This concludes collector changes pending the human-observed filename/link if the artifact remains absent.

Measured capture correction: at10:24:20 the final passive supplement found three visible SPAN role-link controls whose attributes matched the exact armed fixture-delete response filename. Capture omitted role-link controls. A new exact-only role-link branch uses bounded download/aria-label/title/data-file-name attributes within owned main and excludes user/composer/sidebar/disabled/inert/hidden controls. It reads neither answer text nor href, cannot enter generic latest-response fallback and preserves fresh-assistant/duplicate precedence. Token suffix guards reject `expected.zip.pdf` and longer names. Tests reproduce missing capture before the fix and verify strict selection afterward. Full gate recorded in desktop-rolelink-capture-build-final-20261009.log; live activation remains root-owned.

Native role-link correction: after exact synthetic selections at10:34:32 produced no download events or bytes, role-link scripts now locate a point without DOM click. The Supervisor performs a named fresh exact-attribute lookup, verifies hit/viewport geometry and unchanged request/slot/conversation/transport state, then commits via the existing trusted renderer input helper with scoped hidden-page focus emulation. Only the selected exact activation target may scroll into view; passive diagnosis never scrolls. Pending/progress is stamped only after accepted native input. Legacy Worker string callers exclude role-links and retain working prior controls, including an exact legacy button when a role-link is also present. Tests cover missing/changed targets, stale expectation/slot, context changes during focus/lookup, invalid points, blocked/disabled/input controls, no WC focus and real hidden renderer input events. Gate recorded in desktop-native-rolelink-build-final-20261009.log; validated bytes remain the live acceptance criterion.
