package app

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestProjectPromptDoesNotOfferWharnexRuntimeDatabaseAsProjectSQL(t *testing.T) {
	service, root := environmentService(t, false)
	if err := service.SetInternalPostgresConnectionURL("postgres://runtime:private@127.0.0.1:5432/wharnex?sslmode=disable"); err != nil {
		t.Fatal(err)
	}
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Atualize o banco deste projeto")
	if err != nil {
		t.Fatal(err)
	}
	prompt := prompted.LastManualPrompt
	for _, want := range []string{
		"wharnex-internal: Wharnex runtime database only",
		"PROJECT SQL CONNECTION HANDLES: none registered",
		"Do not invent a connection_id",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("project prompt missing %q", want)
		}
	}
	if strings.Contains(prompt, "private@") {
		t.Fatal("database credential leaked into planner prompt")
	}
}
