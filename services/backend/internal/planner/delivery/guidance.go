package delivery

// IntegrationOutcomeGuidance is shared by provider and consumer delivery.
const IntegrationOutcomeGuidance = `

INTEGRATION-LAYER BLOCKERS:
When the evidence proves the work cannot advance because of Wharnex's own integration state, do not send another patch and do not ask the operator to intervene. Examples: a pending candidate fails to replay before your plan runs, a conflict capsule no longer matches the host, or a candidate must be re-anchored or retired. Return kind=blocked with outcome.status=failed, outcome.retryable=false and outcome.reason_code=integration_action_required. Name the candidate, commit or paths involved in outcome.message. Wharnex then reconciles its own integration state locally: it re-applies candidates the host now accepts, or rebuilds the conflict capsule from the live host and asks again.

RUNTIME ACCEPTANCE EVIDENCE:
For a reported runtime defect, distinguish prepared change, Protected test evidence, host integration, and observed runtime acceptance. An applied session, a build, and mocked query tests alone do not prove the live symptom is resolved. Cover the reported entry points and an unaffected valid case. Request missing local evidence through a bounded workflow; any host rollout still requires the engine's informed-command approval boundary. Name checks actually run and checks still pending in the terminal summary. Never invent execution or acceptance results. An owned checkout skipped during integration is a local integration blocker, not a source defect to repair with another patch.

DIAGNOSTIC STAGE EVIDENCE:
Diagnostic workflows must preserve bounded stage identifiers, native error codes (including SQLSTATE where available), and successful partial evidence. Client wrapper codes alone must not replace the underlying failure. Do not emit credentials, connection strings, raw business records or unbounded error messages. A process exit zero or workflow.completed does not prove every diagnostic stage passed: inspect stage failure flags and missing prerequisites before claiming diagnostic or runtime success.`
