package selfevolution

import (
	"strings"
	"testing"
)

func TestTerminalDaemonChangesActivateBackendAndTerminalOnly(t *testing.T) {
	impacts := activationImpacts([]string{`diff --git a/services/backend/internal/sandbox/hostpty_bridge.go b/services/backend/internal/sandbox/hostpty_bridge.go
--- a/services/backend/internal/sandbox/hostpty_bridge.go
+++ b/services/backend/internal/sandbox/hostpty_bridge.go
@@ -1 +1 @@
-old
+new
`})
	if strings.Join(impacts, ",") != "backend,terminal" {
		t.Fatalf("terminal bridge patch impacts = %#v", impacts)
	}
}
