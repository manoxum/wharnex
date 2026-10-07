// Package hostverification classifies measured post-merge host gate failures.
package hostverification

import (
	"regexp"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

var permissionFailure = regexp.MustCompile(`(?i)(?:EACCES: permission denied|EPERM: operation not permitted), (?:open|mkdir|rmdir|unlink|rename|scandir|stat|access) ['"]([^'"\r\n]+)['"]`)

// FilesystemBlock requires an OS errno, filesystem syscall and measured path.
// A source compile error or application authorization refusal is not evidence
// that host filesystem maintenance can resolve the failed verification gate.
func FilesystemBlock(diagnostic string) *hostrepo.BlockedError {
	match := permissionFailure.FindStringSubmatch(diagnostic)
	if len(match) != 2 || len(match[1]) > 4096 {
		return nil
	}
	path := match[1]
	return &hostrepo.BlockedError{
		Reason: hostrepo.BlockedRepositoryPermission,
		Detail: "host verification cannot access a filesystem path: " + strings.TrimSpace(match[0]),
		Paths:  []string{path},
		Remedy: "restore access or safely regenerate the affected build output, then apply the retained verified candidate again",
	}
}
