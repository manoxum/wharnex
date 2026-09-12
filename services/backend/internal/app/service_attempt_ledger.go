package app

import (
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/executionbundle"
)

const (
	// maxAttemptRounds bounds the measured round history. A Main Request that
	// exceeds this has long since stopped converging, and the oldest rounds are
	// the least useful: the ledger narrative has already absorbed their lesson.
	maxAttemptRounds = 24
	// maxAttemptNarrativeBytes bounds the planner-authored ledger. It is meant
	// to be a distilled decision aid, not a transcript; an oversized one is
	// truncated rather than rejected, because losing the whole ledger over
	// length would cost more than losing its tail.
	maxAttemptNarrativeBytes = 48 << 10
	maxAttemptDetailBytes    = 600
	maxAttemptCommands       = 8
	maxAttemptPaths          = 20
)

// attemptLedgerForRoot returns the session's ledger when it belongs to rootID.
// A ledger from a different Main Request is not stale data to be merged — it
// describes a different goal, and feeding it forward is how a planner starts
// "correcting" a problem nobody asked about.
func attemptLedgerForRoot(item domain.Session, rootID string) *domain.AttemptLedger {
	rootID = strings.TrimSpace(rootID)
	if rootID == "" || item.AttemptLedger == nil {
		return nil
	}
	if strings.TrimSpace(item.AttemptLedger.RootRequestID) != rootID {
		return nil
	}
	return item.AttemptLedger
}

// resetAttemptLedger starts a fresh ledger for a new Main Request. Called on
// the same boundary that clears the pending knowledge candidate, because the
// two are the same lifecycle: session-scoped learning lives exactly as long as
// the Main Request that produced it.
func resetAttemptLedger(item *domain.Session, rootID string) {
	rootID = strings.TrimSpace(rootID)
	if rootID == "" {
		item.AttemptLedger = nil
		return
	}
	item.AttemptLedger = &domain.AttemptLedger{
		Protocol: domain.AttemptProtocolV1, RootRequestID: rootID, UpdatedAt: time.Now().UTC(),
	}
}

// recordAttemptRound appends one Wharnex-measured round to the ledger.
//
// The measurement is deliberately Wharnex's own and not the planner's. A round
// that failed must be visible to the next round whether or not the model chose
// to write it down, because the single most expensive failure mode of the
// repair loop is a planner re-proposing an approach an earlier round already
// disproved on this machine.
func recordAttemptRound(item *domain.Session, rootID string, round domain.AttemptRound) {
	ledger := attemptLedgerForRoot(*item, rootID)
	if ledger == nil {
		resetAttemptLedger(item, rootID)
		ledger = item.AttemptLedger
	}
	if ledger == nil {
		return
	}
	round.RequestID = strings.TrimSpace(round.RequestID)
	if round.RequestID == "" {
		return
	}
	round.Detail = truncateRepairText(round.Detail, maxAttemptDetailBytes)
	round.Commands = boundedStrings(round.Commands, maxAttemptCommands)
	round.Paths = boundedStrings(round.Paths, maxAttemptPaths)
	if round.CreatedAt.IsZero() {
		round.CreatedAt = time.Now().UTC()
	}
	// A round is identified by its request. Re-recording one replaces it
	// in place: the same request can be measured twice (a plan is rejected,
	// then its retained payload fails verification) and the later, more
	// specific measurement is the true outcome of that round.
	for index := range ledger.Rounds {
		if ledger.Rounds[index].RequestID == round.RequestID {
			round.Round = ledger.Rounds[index].Round
			ledger.Rounds[index] = round
			ledger.UpdatedAt = time.Now().UTC()
			return
		}
	}
	round.Round = len(ledger.Rounds) + 1
	ledger.Rounds = append(ledger.Rounds, round)
	if len(ledger.Rounds) > maxAttemptRounds {
		ledger.Rounds = append([]domain.AttemptRound(nil), ledger.Rounds[len(ledger.Rounds)-maxAttemptRounds:]...)
	}
	ledger.UpdatedAt = time.Now().UTC()
}

// stageAttemptNarrative records the planner's cumulative ledger from one
// response.
//
// A missing narrative is a degradation, never a rejection: the ledger is
// bookkeeping that exists to make the NEXT round cheaper, and discarding a
// verified patch because its companion prose was absent would be exactly the
// self-inflicted round trip this protocol exists to remove. The previous
// narrative is kept in that case, and the round that failed to refine it is
// recorded so the gap is visible rather than silent.
func stageAttemptNarrative(item *domain.Session, rootID, requestID, narrative string) bool {
	ledger := attemptLedgerForRoot(*item, rootID)
	if ledger == nil {
		resetAttemptLedger(item, rootID)
		ledger = item.AttemptLedger
	}
	if ledger == nil {
		return false
	}
	narrative = strings.TrimSpace(narrative)
	if narrative == "" {
		return false
	}
	if len(narrative) > maxAttemptNarrativeBytes {
		narrative = narrative[:maxAttemptNarrativeBytes] + "\n\n...[truncated by Wharnex]"
	}
	ledger.Narrative = narrative
	ledger.NarrativeRequestID = strings.TrimSpace(requestID)
	ledger.UpdatedAt = time.Now().UTC()
	return true
}

// stageResponseAttemptLedger records the ledger a response bundle returned.
//
// It never fails the ingestion it runs inside. A missing ledger is published as
// a degradation and the previous round's ledger is retained, so the accumulated
// conclusions survive one non-compliant response instead of being reset by it.
func (s *Service) stageResponseAttemptLedger(sessionID string, parsed executionbundle.Parsed) {
	requestID := strings.TrimSpace(parsed.Turn.RequestID)
	if requestID == "" {
		return
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return
	}
	rootID := knowledgeReviewRoot(current, requestID)
	narrative := strings.TrimSpace(parsed.Info.AttemptLedgerNarrative)
	staged := false
	if _, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
		staged = stageAttemptNarrative(item, rootID, requestID, narrative)
		return nil
	}); updateErr != nil {
		return
	}
	if s.bus == nil {
		return
	}
	if staged {
		s.bus.Publish(sessionID, "attempts.ledger_staged", map[string]any{
			"request_id": requestID, "root_request_id": rootID, "bytes": len(narrative),
		})
		return
	}
	s.bus.Publish(sessionID, "attempts.ledger_degraded", map[string]any{
		"request_id": requestID, "root_request_id": rootID,
		"reason": "response bundle did not contain a usable attempts/ledger.md",
		"impact": "the bundle was accepted; the previous round's ledger is retained and the next round starts with less learned context",
	})
}

// clearAttemptLedger drops the session ledger at a Main Request's terminal
// boundary. Its durable residue was already promoted into the knowledge catalog
// by the same response; keeping the scaffolding would leak one request's
// exclusion list into the next one's reasoning.
func clearAttemptLedger(item *domain.Session, rootID string) {
	if attemptLedgerForRoot(*item, rootID) != nil {
		item.AttemptLedger = nil
	}
}

func boundedStrings(values []string, limit int) []string {
	out := make([]string, 0, limit)
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len(value) > 240 {
			value = value[:240] + "…"
		}
		out = append(out, value)
		if len(out) >= limit {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// repairAttemptOutcome classifies why a round is being repaired. The
// distinction matters to the next planner round: a policy refusal means the
// plan was never executed and the patch may be entirely sound, while a
// verification failure means the patch ran and was wrong.
func repairAttemptOutcome(cause error) string {
	if cause == nil {
		return domain.AttemptOutcomeVerificationFailed
	}
	message := cause.Error()
	switch {
	case strings.HasPrefix(message, "policy denied plan:"):
		return domain.AttemptOutcomePolicyBlocked
	case strings.Contains(message, "conflict"):
		return domain.AttemptOutcomeConflict
	case strings.Contains(message, "merge") || strings.Contains(message, "integrat"):
		return domain.AttemptOutcomeIntegrationFailed
	default:
		return domain.AttemptOutcomeVerificationFailed
	}
}

func executionFailureCauseSummary(result domain.ExecutionResult, cause error) string {
	if evidence, missing := detectMissingExecutable(result); missing {
		return fmt.Sprintf("missing executable %q while running %q", evidence.executableName(), evidence.commandLine())
	}
	for index := len(result.Commands) - 1; index >= 0; index-- {
		command := result.Commands[index]
		if command.Success {
			continue
		}
		if attribution := strings.TrimSpace(command.BaselineOutput); attribution != "" {
			return attribution
		}
		if observed := newVerificationFailures(domain.CommandResult{}, command); len(observed) > 0 {
			return "Observed structured verification failures: " + strings.Join(observed, "; ")
		}
	}
	if cause != nil && strings.TrimSpace(cause.Error()) != "" {
		return cause.Error()
	}
	return "execution failed without a diagnostic message"
}

// attemptRoundFromExecution turns a finished execution into one measured round.
func attemptRoundFromExecution(requestID, kind string, result domain.ExecutionResult, outcome, detail string) domain.AttemptRound {
	round := domain.AttemptRound{
		RequestID: requestID, Kind: kind, PlanID: result.PlanID, Outcome: outcome, Detail: detail,
	}
	for _, command := range result.Commands {
		if len(command.Argv) == 0 {
			continue
		}
		round.Commands = append(round.Commands, fmt.Sprintf("%s → exit %d", strings.Join(command.Argv, " "), command.ExitCode))
	}
	return round
}

// renderAttemptLedger produces the prompt section sent on every continuation.
//
// Measured rounds come first and are labelled as Wharnex's own evidence, so the
// planner cannot treat them as its own revisable notes. Its narrative follows
// as the thing it is expected to improve this round.
func renderAttemptLedger(ledger *domain.AttemptLedger, round, bound int) string {
	if ledger == nil || (len(ledger.Rounds) == 0 && strings.TrimSpace(ledger.Narrative) == "") {
		return ""
	}
	var out strings.Builder
	out.WriteString("\nSESSION ATTEMPT LEDGER — " + domain.AttemptProtocolV1 + ":\n")
	out.WriteString(fmt.Sprintf("- This is round %d of Main Request %s.", round, ledger.RootRequestID))
	if bound > 0 {
		out.WriteString(fmt.Sprintf(" The automated budget allows about %d.", bound))
	}
	out.WriteString("\n")
	if len(ledger.Rounds) > 0 {
		out.WriteString("- WHARNEX-MEASURED ROUND HISTORY (authoritative execution evidence, not your notes; every entry here actually happened on this machine):\n")
		for _, entry := range ledger.Rounds {
			out.WriteString(fmt.Sprintf("  [round %d · %s · %s]", entry.Round, entry.Kind, entry.Outcome))
			if entry.PlanID != "" {
				out.WriteString(" plan=" + entry.PlanID)
			}
			out.WriteString("\n")
			if entry.Detail != "" {
				out.WriteString("    " + singleLine(entry.Detail) + "\n")
			}
			for _, command := range entry.Commands {
				out.WriteString("    $ " + singleLine(command) + "\n")
			}
			if len(entry.Paths) > 0 {
				out.WriteString("    paths: " + strings.Join(entry.Paths, ", ") + "\n")
			}
		}
	}
	if narrative := strings.TrimSpace(ledger.Narrative); narrative != "" {
		out.WriteString("- YOUR CUMULATIVE LEDGER as refined through round " + ledger.NarrativeRequestID + ". Improve it this round; do not restart it:\n")
		for _, line := range strings.Split(narrative, "\n") {
			out.WriteString("  | " + line + "\n")
		}
	} else {
		out.WriteString("- You have not produced a ledger yet for this Main Request. Create the complete one this round.\n")
	}
	return out.String()
}

func singleLine(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r", " "), "\n", " ⏎ "))
}

// attemptLedgerStateJSON is the machine-readable companion carried by every
// transport, so a planner reading files rather than prose sees the same
// authoritative round history the prompt describes.
func attemptLedgerStateJSON(ledger *domain.AttemptLedger, requestID string, round, bound int) map[string]any {
	if ledger == nil {
		return nil
	}
	rounds := make([]map[string]any, 0, len(ledger.Rounds))
	for _, entry := range ledger.Rounds {
		record := map[string]any{"round": entry.Round, "request_id": entry.RequestID, "kind": entry.Kind, "outcome": entry.Outcome}
		if entry.PlanID != "" {
			record["plan_id"] = entry.PlanID
		}
		if entry.Detail != "" {
			record["detail"] = entry.Detail
		}
		if len(entry.Commands) > 0 {
			record["commands"] = entry.Commands
		}
		if len(entry.Paths) > 0 {
			record["paths"] = entry.Paths
		}
		rounds = append(rounds, record)
	}
	return map[string]any{
		"protocol": domain.AttemptProtocolV1, "root_request_id": ledger.RootRequestID,
		"request_id": requestID, "round": round, "max_rounds": bound,
		"narrative_file": "attempts/ledger.md", "narrative_request_id": ledger.NarrativeRequestID,
		"rounds": rounds,
	}
}
