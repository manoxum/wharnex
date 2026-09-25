package planner

// IntegrationOutcomeGuidance tells the planner how to report a blocker that
// only Wharnex's integration layer can remove. It is appended to the system
// protocol of every planner transport.
//
// Planners on 2026-09-25 diagnosed such blockers correctly but reported them
// with ad-hoc reason codes, which Wharnex classified as needing operator
// guidance; both chats then waited for an operator who had nothing to add.
// The canonical code maps to integration_action_required, whose recovery the
// engine performs by itself.
const IntegrationOutcomeGuidance = `

INTEGRATION-LAYER BLOCKERS:
When the evidence proves the work cannot advance because of Wharnex's own integration state, do not send another patch and do not ask the operator to intervene. Examples: a pending candidate fails to replay before your plan runs, a conflict capsule no longer matches the host, or a candidate must be re-anchored or retired. Return kind=blocked with outcome.status=failed, outcome.retryable=false and outcome.reason_code=integration_action_required. Name the candidate, commit or paths involved in outcome.message. Wharnex then reconciles its own integration state locally: it re-applies candidates the host now accepts, or rebuilds the conflict capsule from the live host and asks again.`
