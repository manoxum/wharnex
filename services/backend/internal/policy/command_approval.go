package policy

import (
	"sort"

	"kernl.local/harness/backend/internal/domain"
)

func requireCommandApproval(command domain.CommandSpec, decision *domain.PolicyDecision, kind, reason, effect string, bypassInFull, sudoPassword bool) {
	decision.RequiresApproval = true
	decision.Risk = maxRisk(decision.Risk, "high")
	decision.Reasons = append(decision.Reasons, reason)
	decision.ApprovalItems = append(decision.ApprovalItems, domain.ExecutionApproval{
		Kind: kind, Argv: append([]string(nil), command.Argv...), Rationale: command.Rationale, Effect: effect,
		HostImpact: commandHostImpact(command), RequiresSudoPassword: sudoPassword, BypassInFull: bypassInFull,
	})
}

func commandHostImpact(command domain.CommandSpec) string {
	if command.Network {
		return "May alter the selected execution target and communicate over the network; in host-direct modes the effects are on the real workstation/project."
	}
	return "May alter the selected execution target; in host-direct modes the effects are on the real workstation/project."
}

func commandEffect(name string) string {
	switch name {
	case "sh", "bash", "zsh", "fish", "dash":
		return "Invokes a shell/script interpreter; the exact argv is shown for operator review before execution."
	case "rm", "chmod", "chown", "dd", "mkfs", "fdisk", "mount", "umount":
		return "Can modify or remove filesystem/device state."
	case "docker", "podman", "systemctl":
		return "Can modify containers, services, processes, mounts, or other host runtime state."
	case "curl", "wget", "ssh", "scp", "rsync", "nc", "netcat", "socat":
		return "Can communicate with external systems and may transfer data."
	default:
		return "Executes a command family that Wharnex treats as high-impact and therefore exposes for informed approval."
	}
}

var hardDenied = map[string]bool{
	"su": true, "doas": true,
}

var approvalGated = map[string]bool{
	"sh": true, "bash": true, "zsh": true, "fish": true, "dash": true,
	"docker": true, "podman": true, "systemctl": true,
	"mount": true, "umount": true, "iptables": true, "nft": true,
	"curl": true, "wget": true, "nc": true, "netcat": true, "socat": true,
	"ssh": true, "scp": true, "rsync": true, "dd": true, "mkfs": true, "fdisk": true,
	"rm": true, "chmod": true, "chown": true, "kill": true, "pkill": true,
	"python": true, "python3": true, "perl": true, "ruby": true, "php": true,
	"pip": true, "pip3": true, "composer": true,
	"sqlite3": true, "psql": true, "redis-cli": true,
	"fzf": true, "tmux": true,
}

// DeniedExecutables is the small closed set for which Wharnex has no safe
// execution/credential boundary. High-impact commands live in the separate
// approval-required set so the planner may propose them without a repair round.
func DeniedExecutables() []string { return sortedSetKeys(hardDenied) }

func ApprovalRequiredExecutables() []string {
	values := sortedSetKeys(approvalGated)
	values = append(values, "sudo")
	sort.Strings(values)
	return values
}
