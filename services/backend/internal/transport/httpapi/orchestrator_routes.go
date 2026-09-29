package httpapi

import "net/http"

func (a *API) registerOrchestratorRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions/{id}/orchestrator/overview", a.orchestratorOverview)
	mux.HandleFunc("GET /api/sessions/{id}/orchestrator/tasks", a.orchestratorTasks)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/propose", a.orchestratorProposePlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/import", a.orchestratorImportPlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/import-bundle", a.orchestratorImportPlanBundle)
	mux.HandleFunc("GET /api/sessions/{id}/orchestrator/planning/{request_id}", a.orchestratorPlanningDetail)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/planning/{request_id}/retry", a.orchestratorRetryPlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/{plan_id}/approve", a.orchestratorApprovePlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/{plan_id}/reject", a.orchestratorRejectPlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/plans/{plan_id}/revise", a.orchestratorRevisePlan)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks", a.orchestratorCreateTask)
	mux.HandleFunc("GET /api/sessions/{id}/orchestrator/tasks/{task_id}", a.orchestratorTaskDetail)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/transition", a.orchestratorTransitionTask)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/effort", a.orchestratorTaskEffort)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/effort-level", a.orchestratorTaskEffortLevel)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/retry", a.orchestratorRetryTask)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/start", a.orchestratorStartTask)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/worker-start", a.orchestratorWorkerStart)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/worker-bundle", a.orchestratorWorkerBundle)
	mux.HandleFunc("POST /api/sessions/{id}/orchestrator/tasks/{task_id}/worker-conversation", a.orchestratorWorkerConversation)
	mux.HandleFunc("POST /api/orchestrator/tasks/{task_id}/bundle", a.orchestratorTaskBundle)
	mux.HandleFunc("POST /api/orchestrator/tasks/{task_id}/fail-run", a.orchestratorTaskFailRun)
	mux.HandleFunc("GET /api/sessions/{id}/orchestrator/tasks/{task_id}/runs", a.orchestratorTaskRuns)
}
