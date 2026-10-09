package patchcontent_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/executionbundle"
)

func TestBundlePreflightPreservesFiveRawDiffContentShapes(t *testing.T) {
	fence := strings.Repeat("`", 3)
	for name, body := range map[string]string{
		"added fence":    "+" + fence + "go\n+example\n+" + fence + "\n",
		"removed fence":  "-" + fence + "go\n-example\n-" + fence + "\n",
		"context fence":  " " + fence + "go\n example\n " + fence + "\n",
		"source literal": "+const marker = \"" + fence + "\";\n",
		"diff example":   "+diff --git example with \\ and \"quotes\"\n",
	} {
		t.Run(name, func(t *testing.T) {
			oldCount, newCount := 0, 0
			for _, line := range strings.Split(strings.TrimSuffix(body, "\n"), "\n") {
				if line[0] != '+' {
					oldCount++
				}
				if line[0] != '-' {
					newCount++
				}
			}
			header := fmt.Sprintf("@@ -1,%d +1,%d @@\n", oldCount, newCount)
			patch := "--- a/README.md\n+++ b/README.md\n" + header + body
			parsed, err := executionbundle.Parse("whx_bundle_res_system_req_12345678.zip", bundle(t, patch))
			if err != nil {
				t.Fatalf("valid content must not trigger patch preflight rejection: %v", err)
			}
			if parsed.Plan.Operations[0].Patch != patch {
				t.Fatal("patch content was changed during validation")
			}
		})
	}
}

func bundle(t *testing.T, patch string) []byte {
	t.Helper()
	plan, err := json.Marshal(map[string]any{
		"protocol": "harness.execution/v1", "plan_id": "p1", "request_id": "req_12345678",
		"status": "ready", "summary": "Update documentation", "risk": "low", "requires_approval": false,
		"operations": []map[string]any{{"type": "apply_patch", "patch_file": "patches/001.patch"}}, "verification": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	for name, content := range map[string]string{"README.md": "# Documentation update\n", "plan.json": string(plan), "patches/001.patch": patch} {
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
