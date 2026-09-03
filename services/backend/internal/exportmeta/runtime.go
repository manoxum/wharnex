package exportmeta

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	maxRuntimeOutputBytes = 128 * 1024
	maxRuntimeLogLines    = 200
)

func CaptureWharnessRuntime(root string) RuntimeMetadata {
	var runtime RuntimeMetadata
	statusPath := filepath.Join(root, "scripts", "status.sh")
	status, statusErr := runCommand(root, 5*time.Second, statusPath)
	runtime.Status = sanitizeDiagnostics(status)

	logs, logsErr := tailTextFile(
		filepath.Join(root, ".harness", "logs", "desktop.log"),
		maxRuntimeLogLines,
		maxRuntimeOutputBytes,
	)
	runtime.Logs = sanitizeDiagnostics(logs)

	selfLogs, selfLogsErr := tailTextFile(
		filepath.Join(root, ".harness", "logs", "self-evolution.log"),
		maxRuntimeLogLines,
		maxRuntimeOutputBytes,
	)
	if selfLogsErr == nil {
		runtime.SelfEvolutionLogs = sanitizeDiagnostics(selfLogs)
	}

	var warnings []string
	if statusErr != nil {
		warnings = append(warnings, "wharness status: "+statusErr.Error())
	}
	if logsErr != nil {
		warnings = append(warnings, "wharness logs: "+logsErr.Error())
	}
	runtime.Error = strings.Join(warnings, "; ")
	return runtime
}

func tailTextFile(path string, maxLines, maxBytes int) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("desktop log not found")
		}
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	start := info.Size() - int64(maxBytes)
	if start < 0 {
		start = 0
	}
	if _, err := file.Seek(start, 0); err != nil {
		return "", err
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), maxBytes+64*1024)
	lines := make([]string, 0, maxLines)
	for scanner.Scan() {
		if start > 0 && len(lines) == 0 {
			// The first line may be partial because the file was byte-trimmed.
			continue
		}
		lines = append(lines, scanner.Text())
		if len(lines) > maxLines {
			lines = lines[len(lines)-maxLines:]
		}
	}
	if err := scanner.Err(); err != nil {
		return strings.Join(lines, "\n"), err
	}
	return strings.Join(lines, "\n"), nil
}

var diagnosticSecretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(authorization\s*[:=]\s*bearer\s+)[^\s]+`),
	regexp.MustCompile(`(?i)((?:openai_api_key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*)[^\s]+`),
	regexp.MustCompile(`(?i)(https?://[^\s/:@]+:)[^\s@]+(@)`),
}

func sanitizeDiagnostics(value string) string {
	value = strings.TrimSpace(value)
	for _, pattern := range diagnosticSecretPatterns {
		value = pattern.ReplaceAllString(value, `${1}[REDACTED]${2}`)
	}
	return value
}
