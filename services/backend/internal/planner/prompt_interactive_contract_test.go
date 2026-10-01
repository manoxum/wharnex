package planner

import (
	"strings"
	"testing"
)

func TestInteractiveV2PromptPublishesDecodableScopeAndConnectionInventory(t *testing.T) {
	prompt := BuildManualPrompt(Request{
		RequestID: "req_interactive_scope",
		Message:   "Atualize registros no banco do projeto",
	})
	for _, want := range []string{
		`"paths"`, `"connections"`, `"log_sources"`, `"processes"`,
		`"services"`, `"containers"`, `"network_destinations"`,
		`debug.scope.cwd`, `debug.scope.executables`,
		`"connection_id"`, `"statement"`, `"mode"`, `"timeout_seconds"`, `"max_rows"`,
		"Do not invent a connection_id",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("interactive v2 prompt missing %q", want)
		}
	}
}
