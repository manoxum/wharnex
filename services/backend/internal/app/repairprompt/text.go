// Package repairprompt renders the planner requests Wharnex sends after a plan
// failed: policy rejections and execution failures. Callers decide what the
// failure means for the session; this package only turns those facts into the
// bounded request text, so the wording can be tested without a session store.
package repairprompt

import "strings"

const truncatedMarker = "\n...[truncated by Wharnex]"

// Truncate bounds diagnostic text carried into a planner request.
func Truncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + truncatedMarker
}

// TruncateBuildOutput keeps the beginning and end of verbose host-build
// output. The beginning identifies the phase that ran; the end contains the
// exit diagnostic that decides whether a candidate needs source repair or a
// local infrastructure action.
func TruncateBuildOutput(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	head := limit / 3
	tail := limit - head
	return value[:head] + "\n...[middle build output truncated by Wharnex; terminal output retained]...\n" + value[len(value)-tail:]
}

// AppendOperatorGuidance adds operator guidance to a prompt once.
func AppendOperatorGuidance(prompt, guidance string) string {
	if guidance == "" {
		return prompt
	}
	addition := "OPTIONAL OPERATOR GUIDANCE:\n" + guidance
	if strings.Contains(prompt, addition) {
		return prompt
	}
	return strings.TrimSpace(prompt) + "\n\n" + addition
}
