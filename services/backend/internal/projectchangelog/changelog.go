// Package projectchangelog owns root CHANGELOG.md as Wharnex-managed
// bookkeeping, the same way internal/projectconfig owns whaness.yml and
// internal/projectversion owns VERSION: a missing file self-heals to a safe
// default, and Wharnex is the only writer of the structural parts it owns.
//
// CHANGELOG.md is a chronic hot file: every chat that lands a change tends to
// add its entry near the top of the same file, and those edits collide during
// Wharnex's real git merge whenever two chats integrate close together. Git's
// three-way merge already reconciles disjoint edits to one file cleanly — the
// actual lever is giving each chat its own uniquely anchored region instead of
// having every chat fight over the same few lines. This package reserves that
// region (a uniquely named Markdown heading) and later removes it again if the
// chat closed without ever using it.
//
// The reservation insert/delete is deliberately NOT a planner-authored patch.
// If reserving a heading went through the ordinary AI patch/merge pipeline,
// the contention this exists to remove would simply move from "every Apply"
// to "every chat start". Instead this is a serialized, backend-internal
// read-modify-write-commit against the host file, using the same fixed
// non-human identity and no-hooks commit path as hostrepo.CommitInternalPaths
// (see internal/hostrepo/preserve.go's internalCommitArgs) and the caller's
// existing per-project apply lock, so two chats starting concurrently on the
// same project queue briefly on that lock instead of racing a merge. Only the
// content a planner writes *under* its own already-reserved heading travels
// through the ordinary apply_patch/merge path, because that is where real,
// disjoint, mergeable edits belong.
package projectchangelog

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/hostrepo"
)

const (
	// FileName is the root changelog Wharnex bootstraps and reserves sections
	// in. Root-relative, exactly like projectconfig.FileName/projectversion.FileName.
	FileName = "CHANGELOG.md"

	// DefaultContent is written when a project has no CHANGELOG.md at all. It
	// intentionally matches this repository's own convention of one top-level
	// "## Unreleased" section that new entries accumulate under, because that
	// is the heading reservations anchor themselves beneath.
	DefaultContent = "# Changelog\n\n## Unreleased\n"

	// placeholderBody is the sole content of a reservation nobody has written
	// to yet. Its exact text is also the emptiness test: a block whose body is
	// precisely this one line has never been used and is safe to delete when
	// its owning chat closes; anything else is a planner's real contribution
	// and is never removed automatically.
	placeholderBody = "_(reserved — no entries yet)_"
)

// headingPattern matches only a heading this package itself wrote:
// "### Chat <id> (<YYYY-MM-DD>)". The id has no internal whitespace (every
// caller passes a workspace chat id), so a greedy \S+ followed by a literal
// " (" cannot mismatch its boundary.
var headingPattern = regexp.MustCompile(`^### Chat (\S+) \(\d{4}-\d{2}-\d{2}\)\s*$`)

// anyHeadingPattern matches any Markdown ATX heading and is used both to find
// where a reservation block ends and to find the file's own top-level
// structure to insert beneath.
var anyHeadingPattern = regexp.MustCompile(`^#{1,6}\s`)

// Ensure self-heals a missing root CHANGELOG.md, mirroring
// projectconfig.Ensure/projectversion.Ensure: it never overwrites an existing
// file and never commits. Like whaness.yml and VERSION, a freshly created file
// simply waits in the working tree for whatever commit next touches it.
func Ensure(root string) (created bool, err error) {
	path := filepath.Join(root, FileName)
	if _, statErr := os.Stat(path); statErr == nil {
		return false, nil
	} else if !os.IsNotExist(statErr) {
		return false, fmt.Errorf("inspect %s: %w", FileName, statErr)
	}
	if err := os.WriteFile(path, []byte(DefaultContent), 0o644); err != nil {
		return false, fmt.Errorf("create %s: %w", FileName, err)
	}
	return true, nil
}

// Heading renders the exact heading text a reservation for chatID/when owns.
// Exported so the prompt section, the reservation writer and tests all agree
// on the identical text byte-for-byte.
func Heading(chatID string, when time.Time) string {
	return fmt.Sprintf("### Chat %s (%s)", strings.TrimSpace(chatID), when.UTC().Format("2006-01-02"))
}

// Reserve inserts (or reuses) chatID's own CHANGELOG.md heading and commits
// the result as Wharnex-internal bookkeeping. The insertion point is
// immediately beneath the file's first top-level "## " heading (falling back
// to the first "# " heading, then the very top of the file for a malformed or
// legacy CHANGELOG.md), so newest reservations sit first — matching this
// repository's own newest-entries-at-top convention — and exactly two blank
// lines separate one reservation from the next block or from the file's
// pre-existing content, which is what gives Git's merge algorithm enough
// distinct context to treat adjacent blocks as non-overlapping hunks.
//
// Reservation is idempotent per chat id: calling it again for a chat that
// already owns a heading (for example a retried save that raced its own
// earlier commit) returns the existing heading unchanged rather than creating
// a second one.
func Reserve(ctx context.Context, root, chatID string, when time.Time) (heading string, commitSHA string, err error) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return "", "", errors.New("chat id is required to reserve a changelog section")
	}
	if _, err := Ensure(root); err != nil {
		return "", "", err
	}
	path := filepath.Join(root, FileName)
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", "", fmt.Errorf("read %s: %w", FileName, err)
	}
	lines := splitLines(string(raw))
	if existing, ok := locateBlock(lines, chatID); ok {
		return lines[existing.headingLine], "", nil
	}
	heading = Heading(chatID, when)
	updated := spliceReservation(lines, insertionPoint(lines), heading)
	if err := os.WriteFile(path, []byte(joinLines(updated)), 0o644); err != nil {
		return "", "", fmt.Errorf("write %s: %w", FileName, err)
	}
	message := fmt.Sprintf("chore(changelog): reserve section for chat %s", chatID)
	sha, err := hostrepo.CommitInternalPaths(ctx, root, message, []string{FileName})
	if err != nil {
		if errors.Is(err, hostrepo.ErrNothingToCommit) {
			return heading, "", nil
		}
		return "", "", err
	}
	return heading, sha, nil
}

// RemoveEmptyReservation deletes chatID's reservation block and commits the
// result, but only when that block is still exactly the untouched placeholder
// — a planner's real content under the heading is never removed. It returns
// removed=false, nil for every case where there is nothing to do: no
// CHANGELOG.md, no heading for this chat, or a heading whose body has already
// been written to.
//
// Boundary-finding is exact: the block is bounded by its own heading line and
// the next Markdown heading of any level (or EOF), so removing one empty
// block can never consume a byte belonging to a neighboring chat's still-open
// reservation.
func RemoveEmptyReservation(ctx context.Context, root, chatID string) (removed bool, err error) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return false, nil
	}
	path := filepath.Join(root, FileName)
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("read %s: %w", FileName, err)
	}
	lines := splitLines(string(raw))
	block, ok := locateBlock(lines, chatID)
	if !ok || !isEmptyBlock(lines, block) {
		return false, nil
	}
	updated := removeBlock(lines, block)
	if err := os.WriteFile(path, []byte(joinLines(updated)), 0o644); err != nil {
		return false, fmt.Errorf("write %s: %w", FileName, err)
	}
	message := fmt.Sprintf("chore(changelog): drop empty reservation for chat %s", chatID)
	if _, err := hostrepo.CommitInternalPaths(ctx, root, message, []string{FileName}); err != nil {
		if errors.Is(err, hostrepo.ErrNothingToCommit) {
			return true, nil
		}
		return false, err
	}
	return true, nil
}

// RenderPromptSection renders the planner-facing text naming a chat's exact
// reserved heading, so the planner can anchor its patch context on real text
// it can see rather than guessing an insertion point. Returns "" when there is
// no active reservation (bootstrap/commit failed, or the caller never
// attempted one), in which case the prompt simply omits the section — the
// same degrade-open shape as every other measured prompt section in
// internal/planner.
func RenderPromptSection(heading string) string {
	heading = strings.TrimSpace(heading)
	if heading == "" {
		return ""
	}
	return fmt.Sprintf(`PROJECT CHANGELOG RESERVATION:
- Wharnex reserved this exact %s heading for this chat: %s
- When this change should record a changelog entry, add it only under that exact heading: replace or extend the %s placeholder beneath it with real entries, anchoring patch context on the heading line itself so it applies cleanly regardless of other chats' concurrent edits.
- Never create, rename, retitle, or delete this or any other chat's reservation heading, and never edit content that sits under a different "### Chat ..." heading — each chat owns only its own.
- If this change needs no changelog entry, leave the reservation exactly as is.`, FileName, heading, placeholderBody)
}

// block locates one reservation's exact line span: its own heading line and
// the exclusive end of its body (the next Markdown heading, or EOF).
type block struct {
	headingLine int
	bodyStart   int
	bodyEnd     int
}

func locateBlock(lines []string, chatID string) (block, bool) {
	for i, line := range lines {
		match := headingPattern.FindStringSubmatch(line)
		if match == nil || match[1] != chatID {
			continue
		}
		b := block{headingLine: i, bodyStart: i + 1, bodyEnd: len(lines)}
		for j := i + 1; j < len(lines); j++ {
			// A block ends at the next heading of any level, or at the
			// canonical two-blank-line gap this package always writes between
			// one block and whatever comes next — whichever is found first.
			// The double-blank terminator matters for legacy trailing content
			// that follows the last reservation with no heading of its own to
			// stop a heading-only scan at, which would otherwise fold that
			// unrelated content into the block's body and misread it as real,
			// non-empty content this chat wrote.
			if anyHeadingPattern.MatchString(lines[j]) {
				b.bodyEnd = j
				break
			}
			if lines[j] == "" && j+1 < len(lines) && lines[j+1] == "" {
				b.bodyEnd = j
				break
			}
		}
		return b, true
	}
	return block{}, false
}

func isEmptyBlock(lines []string, b block) bool {
	body := trimBlankEdges(lines[b.bodyStart:b.bodyEnd])
	return len(body) == 1 && strings.TrimSpace(body[0]) == placeholderBody
}

// insertionPoint returns the line index a new reservation is inserted at:
// immediately beneath the file's first "## " heading, falling back to the
// first "# " heading, and finally the top of the file for anything else.
func insertionPoint(lines []string) int {
	for i, line := range lines {
		if strings.HasPrefix(line, "## ") {
			return i + 1
		}
	}
	for i, line := range lines {
		if strings.HasPrefix(line, "# ") {
			return i + 1
		}
	}
	return 0
}

// spliceReservation inserts one new block at "at": the heading immediately
// (no blank line — a subsection sits tight under its parent heading, or under
// nothing at all when at==0), then a blank line, then the placeholder, then
// exactly two blank lines before whatever already followed "at" — which is
// trimmed of its own leading blank run first so the two-line gap this
// function adds is the only separator, never three or four.
func spliceReservation(lines []string, at int, heading string) []string {
	before := lines[:at]
	after := trimLeadingBlank(lines[at:])
	out := append([]string{}, before...)
	out = append(out, heading, "", placeholderBody)
	if len(after) > 0 {
		out = append(out, "", "")
		out = append(out, after...)
	}
	return out
}

// removeBlock deletes a located block and restores the canonical two-blank-
// line gap between whatever precedes and follows it — zero blank lines when
// the preceding line is itself a heading (a reservation sits tight under its
// parent, so removing one must not leave a stray gap under that heading), and
// no trailing separator at all when nothing follows.
func removeBlock(lines []string, b block) []string {
	before := trimTrailingBlank(lines[:b.headingLine])
	after := trimLeadingBlank(lines[b.bodyEnd:])
	if len(after) == 0 {
		return before
	}
	if len(before) > 0 && anyHeadingPattern.MatchString(before[len(before)-1]) {
		return append(append([]string{}, before...), after...)
	}
	out := append([]string{}, before...)
	out = append(out, "", "")
	out = append(out, after...)
	return out
}

func trimLeadingBlank(lines []string) []string {
	i := 0
	for i < len(lines) && strings.TrimSpace(lines[i]) == "" {
		i++
	}
	return lines[i:]
}

func trimTrailingBlank(lines []string) []string {
	i := len(lines)
	for i > 0 && strings.TrimSpace(lines[i-1]) == "" {
		i--
	}
	return lines[:i]
}

func trimBlankEdges(lines []string) []string {
	return trimTrailingBlank(trimLeadingBlank(lines))
}

func splitLines(content string) []string {
	content = strings.TrimRight(content, "\n")
	if content == "" {
		return nil
	}
	return strings.Split(content, "\n")
}

func joinLines(lines []string) string {
	return strings.Join(lines, "\n") + "\n"
}
