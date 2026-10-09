package nodecontext

import (
	"fmt"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// TargetCwd selects hydration only; execution keeps the original command intact.
func TargetCwd(command domain.CommandSpec) (string, error) {
	cwd := command.Cwd
	if cwd == "" {
		cwd = "."
	}
	if len(command.Argv) == 0 || filepath.Base(command.Argv[0]) != "pnpm" {
		return cwd, nil
	}
	target := ""
	for i := 1; i < len(command.Argv); i++ {
		arg := command.Argv[i]
		if arg == "--" || !strings.HasPrefix(arg, "-") {
			break
		}
		value := ""
		switch {
		case arg == "--dir" || arg == "-C":
			i++
			if i >= len(command.Argv) || strings.HasPrefix(command.Argv[i], "-") {
				return "", fmt.Errorf("pnpm directory selector requires a relative path")
			}
			value = command.Argv[i]
		case strings.HasPrefix(arg, "--dir="):
			value = strings.TrimPrefix(arg, "--dir=")
		default:
			continue
		}
		if target != "" || value == "" || filepath.IsAbs(value) {
			return "", fmt.Errorf("pnpm directory selector is missing, duplicate or absolute")
		}
		for _, part := range strings.Split(filepath.ToSlash(value), "/") {
			if part == ".." {
				return "", fmt.Errorf("pnpm directory selector contains traversal")
			}
		}
		target = value
	}
	if target == "" {
		return cwd, nil
	}
	return filepath.Join(cwd, target), nil
}
