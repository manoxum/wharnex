package delivery_test

import (
	"encoding/json"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/planner/delivery"
)

func TestProviderContractsDistinguishDiffFramingFromContent(t *testing.T) {
	manual := planner.BuildManualPrompt(planner.Request{RequestID: "req-content", Message: "Update fenced documentation"})
	remote, err := json.Marshal(delivery.BundleContract("response.zip", "https://example.invalid/diff-check.json"))
	if err != nil {
		t.Fatal(err)
	}
	for name, contract := range map[string]string{"manual": manual, "remote": string(remote)} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(contract, "inside valid hunk body lines are ordinary project content; preserve them unchanged") {
				t.Fatal("provider contract must preserve literal hunk content")
			}
			if strings.Contains(contract, "no patch file contains") || strings.Contains(contract, "or if it contains quotes, a backslash, or Markdown fence markers") {
				t.Fatal("provider contract still forbids project content globally")
			}
		})
	}
}
