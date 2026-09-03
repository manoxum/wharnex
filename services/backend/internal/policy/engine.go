package policy

import (
	"fmt"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
)

type Engine struct{}

func NewEngine() *Engine { return &Engine{} }

func (e *Engine) Evaluate(plan domain.ExecutionPlan) domain.PolicyDecision {
	decision := domain.PolicyDecision{Allowed: true, Risk: plan.Risk}
	if err := protocol.Validate(plan); err != nil {
		return domain.PolicyDecision{Allowed: false, Risk: "high", Reasons: []string{err.Error()}}
	}
	if plan.Status == "blocked" {
		return domain.PolicyDecision{Allowed: false, Risk: plan.Risk, Reasons: []string{"planner marked the request blocked"}}
	}
	if plan.RequiresApproval {
		decision.RequiresApproval = true
		decision.Reasons = append(decision.Reasons, "planner requested explicit approval")
	}
	for _, op := range plan.Operations {
		if op.Type == "apply_patch" {
			decision.Risk = maxRisk(decision.Risk, "medium")
			continue
		}
		classifyCommand(op.Command, &decision)
	}
	for _, command := range plan.Verification {
		classifyCommand(command, &decision)
	}
	if decision.Risk == "high" {
		decision.RequiresApproval = true
	}
	return decision
}

func classifyCommand(command domain.CommandSpec, decision *domain.PolicyDecision) {
	if command.Network {
		decision.RequiresApproval = true
		decision.Risk = maxRisk(decision.Risk, "high")
		decision.Reasons = append(decision.Reasons, "command requests network access")
	}
	name := strings.ToLower(filepath.Base(command.Argv[0]))
	if denied[name] {
		decision.Allowed = false
		decision.Risk = "high"
		decision.Reasons = append(decision.Reasons, fmt.Sprintf("executable %q is denied", name))
		return
	}
	if name == "git" {
		if len(command.Argv) < 2 || !allowedGit[strings.ToLower(command.Argv[1])] {
			decision.Allowed = false
			decision.Risk = "high"
			decision.Reasons = append(decision.Reasons, "git mutation/control command denied in model plan")
			return
		}
	}
	if name == "go" && len(command.Argv) >= 2 {
		sub := strings.ToLower(command.Argv[1])
		if sub == "generate" || sub == "install" || sub == "env" {
			decision.Allowed = false
			decision.Risk = "high"
			decision.Reasons = append(decision.Reasons, "unsafe go subcommand denied")
			return
		}
	}
	if name == "npm" && len(command.Argv) >= 2 {
		sub := strings.ToLower(command.Argv[1])
		if sub == "install" || sub == "i" || sub == "publish" {
			decision.RequiresApproval = true
			decision.Risk = maxRisk(decision.Risk, "high")
			decision.Reasons = append(decision.Reasons, "package/network mutation requires approval")
		}
	}
	if elevated[name] {
		decision.RequiresApproval = true
		decision.Risk = maxRisk(decision.Risk, "medium")
		decision.Reasons = append(decision.Reasons, fmt.Sprintf("%s executes project-defined behavior", name))
	}
}

var denied = map[string]bool{
	"sh": true, "bash": true, "zsh": true, "fish": true, "dash": true,
	"sudo": true, "su": true, "docker": true, "podman": true, "systemctl": true,
	"mount": true, "umount": true, "iptables": true, "nft": true,
	"curl": true, "wget": true, "nc": true, "netcat": true, "socat": true,
	"ssh": true, "scp": true, "rsync": true, "dd": true, "mkfs": true, "fdisk": true,
	"rm": true, "chmod": true, "chown": true, "kill": true, "pkill": true,
	"python": true, "python3": true, "perl": true, "ruby": true, "php": true,
}

var elevated = map[string]bool{"make": true, "npm": true, "node": true, "npx": true}
var allowedGit = map[string]bool{"status": true, "diff": true, "grep": true, "ls-files": true, "rev-parse": true, "show": true}

func maxRisk(a, b string) string {
	rank := map[string]int{"low": 1, "medium": 2, "high": 3}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

// EvaluateInteractiveCommand applies the human-terminal policy profile. Unlike
// model plans, an explicitly typed IDE terminal command may mutate the project
// (for example git add/commit, npm install, rm or language runtimes). The
// terminal remains argv-only and blocks shells, privilege escalation and
// host-management primitives that can escape the project boundary.
func (e *Engine) EvaluateInteractiveCommand(command domain.CommandSpec) domain.PolicyDecision {
	if err := protocol.ValidateCommand(command); err != nil {
		return domain.PolicyDecision{Allowed: false, Risk: "high", Reasons: []string{err.Error()}}
	}
	decision := domain.PolicyDecision{Allowed: true, Risk: "low"}
	if command.Network {
		decision.RequiresApproval = true
		decision.Risk = "high"
		decision.Reasons = append(decision.Reasons, "terminal command requests network access")
	}
	name := strings.ToLower(filepath.Base(command.Argv[0]))
	if interactiveDenied[name] {
		decision.Allowed = false
		decision.Risk = "high"
		decision.Reasons = append(decision.Reasons, fmt.Sprintf("executable %q is denied in the interactive terminal", name))
		return decision
	}
	if inlineCodeFlag(name, command.Argv[1:]) {
		decision.Allowed = false
		decision.Risk = "high"
		decision.Reasons = append(decision.Reasons, fmt.Sprintf("inline code execution through %q is denied; execute a project script/file instead", name))
	}
	return decision
}

func inlineCodeFlag(name string, args []string) bool {
	flags := map[string]map[string]bool{
		"python":  {"-c": true},
		"python3": {"-c": true},
		"node":    {"-e": true, "--eval": true, "-p": true, "--print": true},
		"perl":    {"-e": true},
		"ruby":    {"-e": true},
		"php":     {"-r": true},
	}
	for _, arg := range args {
		if flags[name][strings.ToLower(arg)] {
			return true
		}
	}
	return false
}

var interactiveDenied = map[string]bool{
	"sh": true, "bash": true, "zsh": true, "fish": true, "dash": true,
	"sudo": true, "su": true, "doas": true,
	"docker": true, "podman": true,
	"systemctl": true, "service": true, "shutdown": true, "reboot": true, "poweroff": true,
	"mount": true, "umount": true, "iptables": true, "nft": true,
	"mkfs": true, "fdisk": true, "parted": true, "dd": true,
	"kill": true, "pkill": true, "killall": true,
	"ssh": true, "scp": true, "sftp": true, "socat": true, "nc": true, "netcat": true,
}
