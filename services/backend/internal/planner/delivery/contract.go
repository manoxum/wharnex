package delivery

// ManualTemplate is the file-first provider contract for manual delivery.
const ManualTemplate = `%s
%s
REQUEST ID: %s
AUTOMATION MODE: %s
EFFORT LEVEL: %s
SELF-EVOLUTION MODE: %t
BASELINE CONTEXT SHA256: %s
USER REQUEST OR WHARNEX CONTINUATION:
%s

PROJECT MANIFEST:
%s
%s
INTENT REMINDER:
- Do not assume this is coding work merely because a project ZIP is attached.
- If this is a question/advice request and the current context is sufficient, return kind=answer with the COMPLETE useful answer in turn.message and no plan; never return a generic one-line summary such as 'recommendation prepared'.
- If the user explicitly asks for a plan, return kind=plan even when REQUEST STRATEGY is DIRECT. This is a non-mutating approval proposal and carries no plan.json.
- If local evidence is genuinely missing, kind=workflow may request a small evidence step. Ordinary workflow requires AUTOMATION MODE auto or auto_approve and Protected sandbox; harness.interactive/v1 follows its closed observation protocol; harness.interactive/v2 follows its capability/scope protocol.
- If AUTOMATION MODE is manual and this is not a harness.interactive/v1 or harness.interactive/v2 step, do not emit workflow; answer/investigate from current context or ask the user for the needed information.
- Only explicit mutation intent may end in kind=change.

Use the Wharnex context if it is not already represented in this project conversation or if Wharnex supplied a newer snapshot. In local transport it is a ChatGPT attachment; in remote transport read the authorized individual files from file-map.json rather than downloading a ZIP. Fetch only the files needed for the task and use the map's SHA-256 values to verify them when possible.
For AUTOMATIC REPAIR or WORKFLOW CONTINUATION requests sent by Wharnex into the same linked ChatGPT conversation, reuse the project context already attached or mapped when the snapshot is unchanged and do not wait for a duplicate archive.

MANUAL DESKTOP DELIVERY — FILE-FIRST CONTRACT — ABSOLUTE:
EXPECTED OUTPUT FILE: %s

You MUST use ChatGPT's file-generation capability to create exactly that ZIP file. The user must receive the file itself, not a prose substitute.

VISIBLE RESPONSE CONTRACT:
- The final visible answer contains the downloadable ZIP attachment only.
- Do NOT write “Pronto”, “preparei”, summaries, bullet lists, explanations, filenames, JSON, patches, or any other prose in the chat.
- Do NOT call the attachment “Wharnex.zip”, “bundle.zip”, “Baixar o bundle Wharnex.zip”, a UUID/hash, a translated label, or any other name.
- The generated file basename and downloadable filename metadata MUST both be exactly: %s
- Use ChatGPT's generated-file attachment/download mechanism. Do NOT replace the file with an icon-only Markdown link, a bare download emoji, or a prose link whose accessible label hides the canonical filename.
- If a visible attachment/link label is rendered, include the exact canonical filename in that label as well as in the generated file basename.
- If using Python/file tools to create the archive, write the final archive directly with basename %s; do not create a differently named archive and merely describe it as canonical afterward.
- If file generation is unavailable, output exactly BUNDLE_GENERATION_UNAVAILABLE and nothing else.

ZIP ROOT CONTRACT:
- Do NOT wrap the required files inside another top-level directory.
- README.md MUST exist at ZIP root and MUST contain non-whitespace UTF-8 Markdown.
- turn.json MUST exist at ZIP root and MUST be UTF-8 harness.turn/v1 with protocol, request_id, kind, chat_title, message, outcome, plus optional resolved_evidence_ids only when the active WHX review supplied those event IDs.
- chat_title MUST follow the PROVIDER TURN OUTPUT title rules: concise, representative of the actual Main Request, never derived from WHARNEX/ZIP/bundle transport wording, and never prefixed with WHX:.
- resolved_evidence_ids MUST contain only reviewed events actually fixed by this change. Wharnex validates the selection and records resolution only after successful host Apply.
- outcome MUST truthfully report whether you completed this request: {"status":"completed","reason_code":"","message":"","retryable":false}, or status=failed/partial with a concrete message and accurate retryable flag. It reports planner completion, never host execution. A failed/partial outcome MUST NOT include plan.json or patches.
- For kind=change OR kind=workflow, plan.json MUST exist at ZIP root.
- For kind=change, patches referenced by patch_file MUST exist under patches/*.patch.
- For kind=workflow, patches/ MUST NOT exist. Ordinary and harness.interactive/v1 operations MUST be command-only with network=false; harness.interactive/v2 MAY use only its declared typed operations and follows its explicit network capability/scope and approval rules.
- For answer, clarification, investigation, plan and blocked, plan.json and patches/ MUST NOT exist.
- Do NOT package modified project source files directly as the execution result. Project mutation is represented only by a change plan.json + referenced raw unified-diff patches.
- attempts/ledger.md MUST exist at ZIP root level under attempts/, for every turn kind including blocked, and MUST follow the SESSION ATTEMPT LEDGER PROTOCOL section above.
- Optional non-executable support material may exist only under docs/, metadata/, or artifacts/.
- User-facing files intended for inline/local chat presentation MUST be stored under artifacts/. Wharnex discovers those entries from the validated response bundle and renders supported media/documents/code locally with download fallback.
- Treat artifacts/ as non-executable presentation data only; never place plan.json, patch files, commands, secrets, or required protocol metadata there.

CHANGE PLAN CONTRACT:
- request_id in turn.json and plan.json MUST be exactly %q.
- base_context_sha256 in plan.json MUST be exactly %q.
- impact_files MUST list the relative project files/areas you expect this change can touch. read_files lists concrete files relied upon but not written. barrier_files lists dependency/build/schema/protocol inputs that require broad verification if concurrently changed. document, dependencies and system_tools (including acquisition strategies for prerequisites that may be absent) MUST give the operator the complete execution contract before consent. Wharnex uses the actual patch result as the authoritative write set.
- version_increment MUST exist for kind=change and contain exactly component=major|medium|minor|patch plus amount=1..1000. It is an engine instruction, not a project-file patch. Root VERSION is owned by Wharnex: NEVER include VERSION in patch bytes or impact_files.
- plan.json uses harness.execution/v2. apply_patch operations SHOULD use patch_file=patches/NNN-description.patch and an empty patch string.
- patch files are raw UTF-8 standard unified diffs accepted by git apply; never use proprietary *** Begin Patch syntax.
- PATCH FILE BYTE RULE (mandatory): every patches/*.patch file is raw diff bytes, never Markdown and never fenced with three-backtick diff. Every diff --git header has exactly this shape: diff --git a/relative/path b/relative/path. It has exactly two unquoted, space-free paths, no trailing backslash, and no extra words. Follow it with matching --- a/... and +++ b/... lines (or /dev/null for create/delete). Do not place source-code examples containing diff --git outside a real patch header.
- Before zipping, parse actual diff headers and counted hunk bodies separately: reject noncanonical headers and Markdown wrappers outside hunks. Fence markers, quotes, backslashes and diff examples inside valid hunk body lines are ordinary project content; preserve them unchanged.
- ANTI PING-PONG RULE: do one deliberate build and self-check before attaching. Never attach a speculative, partial, or knowingly invalid executable bundle just to continue the conversation. If you cannot make every patch and plan conform after that self-check, create a valid terminal blocked bundle (turn.json plus README.md, with no plan.json or patches/) that names the concrete blocker. Wharnex will not execute malformed bundles and will not accept ordinary prose as a substitute.
- command operations remain argv arrays and never use shell strings.

WORKFLOW PLAN CONTRACT:
- request_id in turn.json and plan.json MUST be exactly %q.
- kind MUST be workflow only when another local evidence-gathering or explicitly requested debug host-action round is truly useful. In Partial context mode, use context_request for specific captured file bodies instead of a workflow command.
- plan.json uses harness.execution/v2 with status=ready. Ordinary/debug-observe workflow uses risk=low|medium and requires_approval=false; debug host modify uses risk=high and requires_approval=true.
- operations contain 1..16 operations. Ordinary and harness.interactive/v1 workflows are command-only with empty patch and network=false. harness.interactive/v2 may instead use command|shell|sql|logs|filesystem|process|network|container|service, but every operation must match a declared capability/scope and verification must be empty.
- NEVER use apply_patch in workflow. Ordinary workflow state is discarded with the sandbox; interactive v2 host modify executes only the exact approved typed operations directly on the host and is never converted into an Apply candidate.
- Keep probes targeted. Prefer inspecting/testing the specific uncertainty rather than running broad expensive suites by default.

MANDATORY SELF-CHECK BEFORE ATTACHING:
1. Build the ZIP programmatically, not by returning separate files.
2. Re-open the generated ZIP.
3. Verify its basename equals %s.
4. Verify README.md exists and strip(README.md) is non-empty.
5. Verify turn.json exists and request_id is %q.
6. If kind=change or kind=workflow, verify plan.json exists and its request_id is %q.
7. If kind=change, verify every patch_file referenced by plan.json exists inside the ZIP, version_increment is valid, and no patch header/path or impact_files entry targets root VERSION.
8. If kind=workflow, verify there are no patch files and version_increment is absent; ordinary/v1 operations are command-only, while interactive v2 operations are limited to the declared typed capability union and obey its network/scope/approval rules.
9. Verify required files are at ZIP root rather than under a wrapper folder.
10. Verify attempts/ledger.md exists, carries all five required sections, and that nothing you are proposing this round appears under its "Does not work locally" section.
11. If kind=change, verify BUNDLE COMPLETENESS: every module, symbol, type and config key your patches reference is either present in the PROJECT MANIFEST or created by a patch in this same ZIP.
12. Only after every check passes, attach that exact ZIP as the final answer.

Canonical change bundle:
%s
├── turn.json
├── plan.json
├── README.md
├── summary.md
├── attempts/
│   └── ledger.md
├── knowledge/
│   ├── index.json
│   └── <id>.md
└── patches/
    ├── 001-main-change.patch
    └── ...

Canonical workflow bundle:
%s
├── turn.json
├── plan.json
├── README.md
├── summary.md
├── attempts/
│   └── ledger.md
└── knowledge/
    ├── index.json
    └── <id>.md

Wharnex validates and policy-checks executable content after download. Ordinary workflow commands run in a disposable Protected sandbox; interactive v1 follows its closed host-observe rules and interactive v2 follows its capability/scoped host observe/modify rules. Outputs are sent back to this same conversation for another bounded reasoning round. The Desktop may normalize a harmless transport filename to the pending canonical request filename, but the JSON request_id and bundle structure remain authoritative.`
