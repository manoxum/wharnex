package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

func TestRunsOfATaskThatEndedWithoutReportingAreClosed(t *testing.T) {
	routes, mux, project := chainFixture(t)
	payload := runOnly(t, routes, mux, "create-item") // runOnly cancels the task after queuing it
	if response := call(t, mux, http.MethodGet, "/api/sessions/ses_chain/ui-testing", nil); response.Code != 200 {
		t.Fatalf("status=%d", response.Code)
	}
	doc, _ := routes.store.Load(project)
	for _, item := range payload.Chain {
		for _, run := range doc.Runs {
			if run.ID == item.RunID && (run.Status != "failed" || strings.TrimSpace(run.Error) == "") {
				t.Fatalf("run %s left %s: %q", run.ID, run.Status, run.Error)
			}
		}
	}
	for _, test := range doc.Tests {
		if test.Status == "running" {
			t.Fatalf("test %s stuck running", test.ID)
		}
	}
}
