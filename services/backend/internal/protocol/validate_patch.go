package protocol

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	unifiedDiffHunkHeaderPattern = regexp.MustCompile(`^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@(?: .*)?$`)
	diffGitHeaderPrefix          = "diff " + "--git"
	markdownFenceMarker          = strings.Repeat("`", 3)
)

// ValidatePatch performs the structural preflight required for every textual
// apply_patch operation before Policy or a sandbox sees the bytes. Path safety
// remains a separate concern but both checks intentionally fail closed here.
func ValidatePatch(patch string) error {
	if err := ValidatePatchPaths(patch); err != nil {
		return err
	}
	return validateUnifiedDiffStructure(patch)
}

func validateUnifiedDiffStructure(patch string) error {
	if strings.Contains(patch, markdownFenceMarker) {
		return errors.New("patch must be raw unified diff without Markdown fences")
	}
	lines := strings.Split(strings.ReplaceAll(patch, "\r\n", "\n"), "\n")
	sawStructure := false
	sawOldHeader := false
	sawNewHeader := false
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSuffix(lines[index], "\r")
		if strings.Contains(line, diffGitHeaderPrefix) && !strings.HasPrefix(line, diffGitHeaderPrefix+" ") {
			return fmt.Errorf("line %d: malformed Git diff header", index+1)
		}
		switch {
		case strings.HasPrefix(line, diffGitHeaderPrefix+" "):
			if _, _, err := canonicalDiffGitPaths(line); err != nil {
				return fmt.Errorf("line %d: %w", index+1, err)
			}
			sawStructure = true
			sawOldHeader = false
			sawNewHeader = false
		case strings.HasPrefix(line, "--- "):
			sawStructure = true
			sawOldHeader = true
			sawNewHeader = false
		case strings.HasPrefix(line, "+++ "):
			if !sawOldHeader {
				return fmt.Errorf("line %d: +++ header requires a preceding --- header", index+1)
			}
			sawNewHeader = true
		case strings.HasPrefix(line, "@@"):
			if !sawNewHeader {
				return fmt.Errorf("line %d: hunk header requires a preceding ---/+++ pair", index+1)
			}
			oldExpected, newExpected, err := parseUnifiedDiffHunkHeader(line)
			if err != nil {
				return fmt.Errorf("line %d: %w", index+1, err)
			}
			oldActual, newActual := 0, 0
			body := index + 1
			for ; body < len(lines) && (oldActual < oldExpected || newActual < newExpected); body++ {
				current := strings.TrimSuffix(lines[body], "\r")
				if current == `\ No newline at end of file` {
					continue
				}
				if current == "" {
					return fmt.Errorf("line %d: hunk ended before declared counts old=%d new=%d were satisfied", index+1, oldExpected, newExpected)
				}
				switch current[0] {
				case ' ':
					oldActual++
					newActual++
				case '-':
					oldActual++
				case '+':
					newActual++
				default:
					return fmt.Errorf("line %d: invalid unified diff hunk body line", body+1)
				}
				if oldActual > oldExpected || newActual > newExpected {
					return fmt.Errorf("line %d: hunk body exceeds declared counts old=%d new=%d", index+1, oldExpected, newExpected)
				}
			}
			if oldActual != oldExpected || newActual != newExpected {
				return fmt.Errorf("line %d: hunk count mismatch: declared old=%d new=%d, got old=%d new=%d", index+1, oldExpected, newExpected, oldActual, newActual)
			}
			for body < len(lines) && strings.TrimSuffix(lines[body], "\r") == `\ No newline at end of file` {
				body++
			}
			if body < len(lines) {
				next := strings.TrimSuffix(lines[body], "\r")
				if next != "" && (next[0] == ' ' || next[0] == '+' || next[0] == '-') &&
					!strings.HasPrefix(next, "+++ ") && !strings.HasPrefix(next, "--- ") {
					return fmt.Errorf("line %d: hunk body exceeds declared line counts", body+1)
				}
			}
			index = body - 1
		case line == "":
			// Empty separators and the terminal newline are harmless outside a hunk.
		case strings.HasPrefix(line, `\ No newline at end of file`):
			return fmt.Errorf("line %d: no-newline marker appears outside a hunk", index+1)
		case strings.HasPrefix(line, "+"), strings.HasPrefix(line, "-"), strings.HasPrefix(line, " "):
			if strings.TrimSpace(line) != "" {
				return fmt.Errorf("line %d: patch body line appears outside a hunk", index+1)
			}
		}
	}
	if !sawStructure {
		return errors.New("patch is not a unified diff")
	}
	return nil
}

func canonicalDiffGitPaths(line string) (string, string, error) {
	if strings.ContainsAny(line, "\t\r\n") {
		return "", "", errors.New("Git diff header must use canonical single-space separators")
	}
	parts := strings.Split(line, " ")
	if len(parts) != 4 || parts[0] != "diff" || parts[1] != "--git" || parts[2] == "" || parts[3] == "" {
		return "", "", errors.New("malformed Git diff header")
	}
	if !strings.HasPrefix(parts[2], "a/") || !strings.HasPrefix(parts[3], "b/") {
		return "", "", errors.New("Git diff paths must use canonical a/ and b/ prefixes")
	}
	for _, value := range parts[2:] {
		if strings.ContainsAny(value, `"\\`) {
			return "", "", errors.New("quoted/escaped Git diff paths are denied")
		}
		if err := validatePatchPath(value); err != nil {
			return "", "", err
		}
	}
	return parts[2], parts[3], nil
}

func parseUnifiedDiffHunkHeader(line string) (int, int, error) {
	matches := unifiedDiffHunkHeaderPattern.FindStringSubmatch(line)
	if matches == nil {
		return 0, 0, errors.New("malformed unified diff hunk header")
	}
	oldCount, err := unifiedDiffRangeCount(matches[2])
	if err != nil {
		return 0, 0, err
	}
	newCount, err := unifiedDiffRangeCount(matches[4])
	if err != nil {
		return 0, 0, err
	}
	return oldCount, newCount, nil
}

func unifiedDiffRangeCount(raw string) (int, error) {
	if raw == "" {
		return 1, nil
	}
	count, err := strconv.Atoi(raw)
	if err != nil || count < 0 {
		return 0, errors.New("invalid unified diff hunk count")
	}
	return count, nil
}
