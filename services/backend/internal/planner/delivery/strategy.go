package delivery

func RequestStrategy(mode string) string {
	header := ""
	planningMode := mode
	if planningMode == "" {
		planningMode = "direct"
	}
	if planningMode == "plan_first" {
		header += `REQUEST STRATEGY: PLAN_FIRST
This turn is planning-only. Produce a concrete implementation proposal with a ## TODO checklist, affected areas, risks, verification and trade-offs. Return kind=plan with turn.json + README.md only, with NO plan.json and NO patches/. Do NOT implement or mutate anything yet. Wharnex will present the proposal to the user and a linked plan_approval request will continue the same Main Request after approval.

`
	} else if planningMode == "approve_plan" {
		header += `REQUEST STRATEGY: APPROVE_PLAN
The user explicitly approved the plan from the parent request in this same Main Request. Implement that approved proposal now; do not reinterpret this as a new Main Request, do not silently expand scope, and include the required ## TODO checklist in turn.message. The execution plan MUST carry approved_chat_plan with protocol=harness.chat-plan/v1, the parent request id, the exact SHA-256 supplied in the continuation, and the exact approved proposal text byte-for-byte. This binding is the user's one authorization for the declared implementation, sandbox verification and Protected Auto host Apply.

`
	} else if planningMode == "correct_plan" {
		header += `REQUEST STRATEGY: CORRECT_PLAN
The user explicitly requested a correction to the plan from the parent request in this same Main Request. This turn is planning-only: revise the proposal using the supplied correction guidance, preserve unaffected scope, and return kind=plan with turn.json + README.md only, with NO plan.json and NO patches/. Do NOT implement or mutate anything yet. The corrected proposal supersedes the parent proposal and requires a fresh user approval before implementation.

`
	} else if planningMode == "adjust_plan" {
		header += `REQUEST STRATEGY: ADJUST_PLAN
The user explicitly requested an adjustment to the unintegrated executable plan from the parent request in this same Main Request. The parent may be an unexecuted proposal or a failed Protected candidate with no pending host integration. This is not a failure correction and not a planning-only plan correction. It is explicit operator review guidance; infrastructure recovery remains engine-owned. Use the operator's full composer prompt, inline directives, attachments, requests/main.md, requests/adjustment.md and the prior response bundles to produce a fresh executable result that supersedes the parent plan. Preserve unaffected intent, never execute the old plan, and return the revised implementation as a normal change bundle with a complete plan/patch set. If the requested adjustment cannot safely become an executable change, return an appropriate terminal blocked or clarification result rather than kind=plan.

`
	} else {
		header += `REQUEST STRATEGY: DIRECT
For explicit CHANGE requests, implement the requested change in this turn and include the required ## TODO checklist in turn.message. If the user's words explicitly ask you to elaborate, propose, draft or present an implementation plan for approval before changing anything, detect that intent even when the UI Plan-first toggle is off: return kind=plan with no plan.json or patches and wait for the linked approval continuation.

`
	}
	return header
}
