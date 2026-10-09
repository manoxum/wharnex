package delivery

// BundleContract describes the compatibility remote-channel result format.
func BundleContract(filename, diffCheckURL string) map[string]any {
	return map[string]any{
		"protocol": "wharness.execution-bundle/v1", // Shipped wire identity.
		"filename": filename, "required_context_field": "base_context_sha256",
		"outcome_status_values": []string{"completed", "failed", "partial"},
		"outcome_rule":          "Use completed only when the request was actually completed; otherwise use failed or partial and explain the truthful result.",
		"events_optional":       true, "final_diff_check": diffCheckURL,
		"patch_delivery":  "patch_file",
		"patch_file_rule": "Raw UTF-8 unified diff only; never wrap the diff in Markdown fences. Fence markers, quotes, backslashes and diff examples inside valid hunk body lines are ordinary project content; preserve them unchanged. Each diff --git header is exactly: diff --git a/relative/path b/relative/path — exactly two unquoted paths, no backslash or extra text.",
		"patch_self_check": []string{
			"every patch_file resolves under patches/*.patch",
			"no Markdown fence wrappers outside counted hunk bodies",
			"every diff --git header has exactly two paths",
			"fetch diff-check.json immediately before delivery",
			"git apply --check accepts every patch against the current context",
		},
	}
}
