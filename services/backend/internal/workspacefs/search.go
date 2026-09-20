package workspacefs

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const DefaultSearchLimit = 250
const MaxSearchLimit = 1000

type SearchOptions struct {
	Query         string
	CaseSensitive bool
	Regex         bool
	WholeWord     bool
	Fuzzy         bool
	Limit         int
}

type SearchMatch struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview"`
}

type SearchResult struct {
	Matches   []SearchMatch `json:"matches"`
	Truncated bool          `json:"truncated"`
}

func Search(root string, options SearchOptions) (SearchResult, error) {
	query := strings.TrimSpace(options.Query)
	if query == "" {
		return SearchResult{Matches: []SearchMatch{}}, nil
	}
	limit := options.Limit
	if limit <= 0 {
		limit = DefaultSearchLimit
	}
	if limit > MaxSearchLimit {
		limit = MaxSearchLimit
	}

	matcher, err := newSearchMatcher(query, options)
	if err != nil {
		return SearchResult{}, err
	}
	entries, err := List(root)
	if err != nil {
		return SearchResult{}, err
	}
	result := SearchResult{Matches: make([]SearchMatch, 0, min(limit, 64))}
	for _, entry := range entries {
		if entry.Kind != "file" || entry.Size > MaxEditableBytes {
			continue
		}
		file, readErr := Read(root, entry.Path)
		if readErr != nil {
			continue
		}
		for lineIndex, line := range strings.Split(file.Content, "\n") {
			column, ok := matcher(line)
			if !ok {
				continue
			}
			if len(result.Matches) >= limit {
				result.Truncated = true
				return result, nil
			}
			result.Matches = append(result.Matches, SearchMatch{
				Path:    entry.Path,
				Line:    lineIndex + 1,
				Column:  utf16SearchColumn(line, column),
				Preview: compactSearchPreview(line, column),
			})
		}
	}
	return result, nil
}

type lineMatcher func(string) (int, bool)

func newSearchMatcher(query string, options SearchOptions) (lineMatcher, error) {
	if options.Regex {
		pattern := query
		if options.WholeWord {
			pattern = `\b(?:` + pattern + `)\b`
		}
		if !options.CaseSensitive {
			pattern = `(?i)` + pattern
		}
		expression, err := regexp.Compile(pattern)
		if err != nil {
			return nil, err
		}
		return func(line string) (int, bool) {
			match := expression.FindStringIndex(line)
			if match == nil {
				return 0, false
			}
			return match[0], true
		}, nil
	}

	if options.Fuzzy {
		return func(line string) (int, bool) {
			return fuzzyLineMatch(line, query, options.CaseSensitive)
		}, nil
	}

	needle := query
	if !options.CaseSensitive {
		needle = strings.ToLower(needle)
	}
	return func(line string) (int, bool) {
		haystack := line
		if !options.CaseSensitive {
			haystack = strings.ToLower(haystack)
		}
		start := 0
		for {
			index := strings.Index(haystack[start:], needle)
			if index < 0 {
				return 0, false
			}
			index += start
			if !options.WholeWord || hasWordBoundaries(haystack, index, index+len(needle)) {
				return index, true
			}
			start = index + max(1, len(needle))
			if start >= len(haystack) {
				return 0, false
			}
		}
	}, nil
}

func hasWordBoundaries(value string, start, end int) bool {
	leftOK := start == 0 || !isWordRune(lastRune(value[:start]))
	rightOK := end >= len(value) || !isWordRune(firstRune(value[end:]))
	return leftOK && rightOK
}

func firstRune(value string) rune {
	r, _ := utf8.DecodeRuneInString(value)
	return r
}

func lastRune(value string) rune {
	r, _ := utf8.DecodeLastRuneInString(value)
	return r
}

func isWordRune(value rune) bool {
	return value == '_' || unicode.IsLetter(value) || unicode.IsDigit(value)
}

type fuzzyCandidate struct {
	start int
	score int
}

func fuzzyLineMatch(line, query string, caseSensitive bool) (int, bool) {
	if !caseSensitive {
		line = strings.ToLower(line)
		query = strings.ToLower(query)
	}
	queryTokens := searchTokens(query)
	if len(queryTokens) == 0 {
		return 0, false
	}
	lineTokens := searchTokenRanges(line)
	if len(lineTokens) == 0 {
		return 0, false
	}
	best := fuzzyCandidate{start: -1, score: 1 << 30}
	for _, queryToken := range queryTokens {
		matched := false
		for _, candidate := range lineTokens {
			distance := boundedEditDistance(queryToken, candidate.value, fuzzyThreshold(queryToken))
			if distance < 0 {
				continue
			}
			matched = true
			if distance < best.score {
				best = fuzzyCandidate{start: candidate.start, score: distance}
			}
		}
		if !matched {
			return 0, false
		}
	}
	return best.start, best.start >= 0
}

type tokenRange struct {
	value string
	start int
}

func searchTokens(value string) []string {
	ranges := searchTokenRanges(value)
	tokens := make([]string, 0, len(ranges))
	for _, item := range ranges {
		tokens = append(tokens, item.value)
	}
	return tokens
}

func searchTokenRanges(value string) []tokenRange {
	result := make([]tokenRange, 0, 8)
	start := -1
	for index, r := range value {
		if isWordRune(r) {
			if start < 0 {
				start = index
			}
			continue
		}
		if start >= 0 {
			result = append(result, tokenRange{value: value[start:index], start: start})
			start = -1
		}
	}
	if start >= 0 {
		result = append(result, tokenRange{value: value[start:], start: start})
	}
	return result
}

func fuzzyThreshold(query string) int {
	length := utf8.RuneCountInString(query)
	switch {
	case length <= 3:
		return 0
	case length <= 7:
		return 1
	default:
		return 2
	}
}

func boundedEditDistance(a, b string, limit int) int {
	if limit < 0 {
		return -1
	}
	aRunes := []rune(a)
	bRunes := []rune(b)
	if abs(len(aRunes)-len(bRunes)) > limit {
		return -1
	}
	previous := make([]int, len(bRunes)+1)
	current := make([]int, len(bRunes)+1)
	for j := range previous {
		previous[j] = j
	}
	for i, ar := range aRunes {
		current[0] = i + 1
		rowMin := current[0]
		for j, br := range bRunes {
			cost := 0
			if ar != br {
				cost = 1
			}
			current[j+1] = min(previous[j+1]+1, current[j]+1, previous[j]+cost)
			rowMin = min(rowMin, current[j+1])
		}
		if rowMin > limit {
			return -1
		}
		previous, current = current, previous
	}
	if previous[len(bRunes)] > limit {
		return -1
	}
	return previous[len(bRunes)]
}

func utf16SearchColumn(line string, byteColumn int) int {
	byteColumn = min(max(byteColumn, 0), len(line))
	units := 0
	for _, r := range line[:byteColumn] {
		units++
		if r > 0xffff {
			units++
		}
	}
	return units + 1
}

func compactSearchPreview(line string, byteColumn int) string {
	const maxRunes = 180
	trimmed := strings.TrimSpace(line)
	if utf8.RuneCountInString(trimmed) <= maxRunes {
		return trimmed
	}
	byteColumn = min(max(byteColumn, 0), len(line))
	matchRune := utf8.RuneCountInString(line[:byteColumn])
	runes := []rune(line)
	start := max(0, matchRune-60)
	end := min(len(runes), start+maxRunes)
	preview := strings.TrimSpace(string(runes[start:end]))
	prefix := ""
	suffix := ""
	if start > 0 {
		prefix = "…"
	}
	if end < len(runes) {
		suffix = "…"
	}
	return prefix + preview + suffix
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
