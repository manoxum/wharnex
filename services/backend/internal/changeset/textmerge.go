package changeset

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

// MergeTier names how far down the local resolution ladder a text merge had to
// go before it produced a clean result.
//
// The ladder exists because line granularity is an implementation detail of
// the merge tool, not a property of the change. Two writers editing different
// arguments of the same long call — the ordinary shape of a JSX prop list or a
// function signature — collide at line granularity and do not collide at all
// at token granularity. Escalating that to a human or to the planner spends a
// round on a collision that never existed.
type MergeTier string

const (
	// MergeTierIdentical means one side did not move: no merge was required.
	MergeTierIdentical MergeTier = "identical"
	// MergeTierLine means Git's own line-granular three-way merge was clean.
	MergeTierLine MergeTier = "line"
	// MergeTierToken means the line merge conflicted and every conflicting
	// hunk was reconciled by re-merging that hunk alone at token granularity.
	MergeTierToken MergeTier = "token"
	// MergeTierUnresolved means the ladder was exhausted.
	MergeTierUnresolved MergeTier = "unresolved"
)

// TextMergeReport is the evidence behind one file's merge decision. It is the
// input to complexity classification, so it records what was attempted and not
// only what came out.
type TextMergeReport struct {
	Tier MergeTier
	// Hunks is the number of conflicting regions the line tier produced.
	Hunks int
	// TokenResolved is how many of those the token tier reconciled.
	TokenResolved int
	// ConflictLines counts the lines inside the regions the ladder could not
	// reconcile, on the widest side of each.
	ConflictLines int
	// TokenOverlap is true when at least one unresolved hunk had both sides
	// rewriting the same tokens. That is a genuine semantic collision rather
	// than a granularity artefact, and no finer merge can decide it.
	TokenOverlap bool
}

// defaultMarkerSize is Git's conflict marker width. The parser raises it above
// any marker-like run the inputs themselves contain so file content can never
// be mistaken for a marker the merge produced.
const defaultMarkerSize = 7

// maxMarkerSize bounds the widening above. Beyond this the inputs look enough
// like conflict output that parsing them is not worth the risk, and the file
// stays a conflict for a human or the planner to read.
const maxMarkerSize = 60

// mergeTextLadder reconciles current/base/result and reports how it got there.
// A false `clean` is an ordinary conflict outcome, not an error; an error means
// the merge could not be attempted at all.
func mergeTextLadder(current, base, result []byte) ([]byte, bool, TextMergeReport, error) {
	merged, code, err := runMergeFile(current, base, result)
	if err != nil {
		return nil, false, TextMergeReport{Tier: MergeTierUnresolved}, err
	}
	if code == 0 {
		return merged, true, TextMergeReport{Tier: MergeTierLine}, nil
	}

	markerSize, ok := markerSizeFor(current, base, result)
	if !ok {
		// The inputs contain marker-like lines of every width we are willing
		// to use. Parsing the merge output would be guesswork.
		return nil, false, TextMergeReport{Tier: MergeTierUnresolved, Hunks: code}, nil
	}
	annotated, _, err := runMergeFile(current, base, result, "--diff3", "--marker-size="+strconv.Itoa(markerSize))
	if err != nil {
		return nil, false, TextMergeReport{Tier: MergeTierUnresolved, Hunks: code}, err
	}
	segments, err := parseConflictSegments(annotated, markerSize)
	if err != nil {
		return nil, false, TextMergeReport{Tier: MergeTierUnresolved, Hunks: code}, nil
	}

	report := TextMergeReport{Tier: MergeTierToken}
	out := new(bytes.Buffer)
	for _, segment := range segments {
		if !segment.conflict {
			out.Write(segment.text)
			continue
		}
		report.Hunks++
		hunk, resolved, overlap := mergeTokens(segment.ours, segment.base, segment.theirs)
		if resolved {
			report.TokenResolved++
			out.Write(hunk)
			continue
		}
		report.Tier = MergeTierUnresolved
		report.ConflictLines += widestSideLines(segment)
		report.TokenOverlap = report.TokenOverlap || overlap
	}
	if report.Tier == MergeTierUnresolved {
		return nil, false, report, nil
	}
	return out.Bytes(), true, report, nil
}

// runMergeFile wraps `git merge-file`, whose exit status is the number of
// conflicts and not a success flag.
//
// Git documents this as "the exit value ... is negative on error, and the
// number of conflicts otherwise (truncated to 127 ...)". Reading only status 1
// as "conflicted" therefore turns any file with two or more conflicting hunks
// into a hard integration failure, which is exactly what it used to do.
func runMergeFile(current, base, result []byte, extra ...string) ([]byte, int, error) {
	dir, err := os.MkdirTemp("", "wharness-merge-*")
	if err != nil {
		return nil, 0, err
	}
	defer os.RemoveAll(dir)
	paths := []string{filepath.Join(dir, "current"), filepath.Join(dir, "base"), filepath.Join(dir, "result")}
	for index, data := range [][]byte{current, base, result} {
		if writeErr := os.WriteFile(paths[index], data, 0o600); writeErr != nil {
			return nil, 0, writeErr
		}
	}
	argv := append([]string{"merge-file", "-p"}, extra...)
	argv = append(argv, paths...)
	cmd := exec.Command("git", argv...)
	stderr := new(bytes.Buffer)
	cmd.Stderr = stderr
	output, runErr := cmd.Output()
	if runErr == nil {
		return output, 0, nil
	}
	var exitErr *exec.ExitError
	if !errors.As(runErr, &exitErr) {
		return nil, 0, runErr
	}
	code := exitErr.ExitCode()
	if code > 0 && code < 128 {
		return output, code, nil
	}
	detail := truncateDiagnostic(stderr.String())
	if detail == "" {
		return nil, 0, fmt.Errorf("git merge-file failed with status %d", code)
	}
	return nil, 0, fmt.Errorf("git merge-file failed with status %d: %s", code, detail)
}

type conflictSegment struct {
	conflict bool
	text     []byte
	ours     []byte
	base     []byte
	theirs   []byte
}

// parseConflictSegments splits diff3 merge output into clean runs and conflict
// hunks. It fails rather than guess: any marker sequence that does not follow
// the documented order means the output is not what this parser models.
func parseConflictSegments(annotated []byte, markerSize int) ([]conflictSegment, error) {
	open := bytes.Repeat([]byte("<"), markerSize)
	orig := bytes.Repeat([]byte("|"), markerSize)
	sep := bytes.Repeat([]byte("="), markerSize)
	closing := bytes.Repeat([]byte(">"), markerSize)

	segments := make([]conflictSegment, 0)
	clean := new(bytes.Buffer)
	var current *conflictSegment
	var side *[]byte

	for _, line := range splitKeepingLineEndings(annotated) {
		switch {
		case current == nil && hasMarker(line, open):
			if clean.Len() > 0 {
				segments = append(segments, conflictSegment{text: append([]byte(nil), clean.Bytes()...)})
				clean.Reset()
			}
			current = &conflictSegment{conflict: true}
			side = &current.ours
		case current != nil && hasMarker(line, orig):
			if side != &current.ours {
				return nil, errors.New("unexpected base marker in merge output")
			}
			side = &current.base
		case current != nil && hasMarker(line, sep):
			if side != &current.base {
				return nil, errors.New("unexpected separator marker in merge output")
			}
			side = &current.theirs
		case current != nil && hasMarker(line, closing):
			if side != &current.theirs {
				return nil, errors.New("unexpected closing marker in merge output")
			}
			segments = append(segments, *current)
			current = nil
			side = nil
		case current == nil:
			clean.Write(line)
		default:
			*side = append(*side, line...)
		}
	}
	if current != nil {
		return nil, errors.New("unterminated conflict hunk in merge output")
	}
	if clean.Len() > 0 {
		segments = append(segments, conflictSegment{text: append([]byte(nil), clean.Bytes()...)})
	}
	return segments, nil
}

func hasMarker(line, marker []byte) bool {
	if !bytes.HasPrefix(line, marker) {
		return false
	}
	rest := line[len(marker):]
	return len(rest) == 0 || rest[0] == ' ' || rest[0] == '\n' || rest[0] == '\r'
}

// markerSizeFor picks a conflict marker width no input can imitate. RE2 has no
// backreferences, so the leading marker run is measured directly.
func markerSizeFor(blobs ...[]byte) (int, bool) {
	longest := 0
	for _, blob := range blobs {
		for _, line := range splitKeepingLineEndings(blob) {
			if run := leadingMarkerRun(line); run > longest {
				longest = run
			}
		}
	}
	size := defaultMarkerSize
	if longest >= size {
		size = longest + 1
	}
	if size > maxMarkerSize {
		return 0, false
	}
	return size, true
}

// leadingMarkerRun measures how many times a line opens with the same conflict
// marker character.
func leadingMarkerRun(line []byte) int {
	if len(line) == 0 {
		return 0
	}
	switch line[0] {
	case '<', '|', '=', '>':
	default:
		return 0
	}
	run := 1
	for run < len(line) && line[run] == line[0] {
		run++
	}
	return run
}

func splitKeepingLineEndings(data []byte) [][]byte {
	lines := make([][]byte, 0)
	start := 0
	for index := 0; index < len(data); index++ {
		if data[index] == '\n' {
			lines = append(lines, data[start:index+1])
			start = index + 1
		}
	}
	if start < len(data) {
		lines = append(lines, data[start:])
	}
	return lines
}

func widestSideLines(segment conflictSegment) int {
	widest := 0
	for _, side := range [][]byte{segment.ours, segment.base, segment.theirs} {
		if count := len(splitKeepingLineEndings(side)); count > widest {
			widest = count
		}
	}
	return widest
}

// mergeTokens re-runs the same three-way merge over one hunk with each token on
// its own line, so the merge tool's line granularity becomes token
// granularity. The tokenization is lossless, so a clean merge round-trips to
// exact bytes and never invents or drops content.
//
// The second return says whether the hunk was reconciled. The third says
// whether both sides rewrote the same tokens, which is the difference between
// a granularity artefact and a real disagreement about intent.
func mergeTokens(ours, base, theirs []byte) ([]byte, bool, bool) {
	merged, code, err := runMergeFile(tokenize(ours), tokenize(base), tokenize(theirs))
	if err != nil {
		return nil, false, false
	}
	if code != 0 {
		return nil, false, true
	}
	detokenized, ok := detokenize(merged)
	if !ok {
		return nil, false, false
	}
	return detokenized, true, false
}

// tokenize writes one token per line: a maximal run of identifier bytes, or a
// single byte. Bytes that would break the one-token-per-line framing are
// escaped, which makes the transform reversible for arbitrary input including
// binary-ish text and CRLF endings.
func tokenize(data []byte) []byte {
	out := new(bytes.Buffer)
	for index := 0; index < len(data); {
		if isIdentifierByte(data[index]) {
			start := index
			for index < len(data) && isIdentifierByte(data[index]) {
				index++
			}
			out.Write(data[start:index])
			out.WriteByte('\n')
			continue
		}
		writeEscaped(out, data[index])
		out.WriteByte('\n')
		index++
	}
	return out.Bytes()
}

func detokenize(data []byte) ([]byte, bool) {
	out := new(bytes.Buffer)
	for _, line := range splitKeepingLineEndings(data) {
		line = bytes.TrimSuffix(line, []byte("\n"))
		for index := 0; index < len(line); index++ {
			if line[index] != '\\' {
				out.WriteByte(line[index])
				continue
			}
			index++
			if index >= len(line) {
				return nil, false
			}
			switch line[index] {
			case '\\':
				out.WriteByte('\\')
			case 'n':
				out.WriteByte('\n')
			case 'r':
				out.WriteByte('\r')
			default:
				return nil, false
			}
		}
	}
	return out.Bytes(), true
}

func writeEscaped(out *bytes.Buffer, value byte) {
	switch value {
	case '\\':
		out.WriteString(`\\`)
	case '\n':
		out.WriteString(`\n`)
	case '\r':
		out.WriteString(`\r`)
	default:
		out.WriteByte(value)
	}
}

func isIdentifierByte(value byte) bool {
	return value == '_' ||
		(value >= '0' && value <= '9') ||
		(value >= 'a' && value <= 'z') ||
		(value >= 'A' && value <= 'Z') ||
		value >= 0x80
}

func truncateDiagnostic(value string) string {
	const limit = 512
	value = string(bytes.TrimSpace([]byte(value)))
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "..."
}
