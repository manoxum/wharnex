package directives

import (
	"regexp"
	"sort"
	"strings"
)

// KeywordSpec pairs one directive kind's canonical keyword with the alternate
// spellings accepted when typing (never when reading the canonical form).
type KeywordSpec struct {
	Kind    Kind
	Keyword string
	Aliases []string
}

// keywords is the single source of truth for the typed vocabulary. The regex
// alternation and alias lookup are both built from it so parsing cannot drift.
var keywords = []KeywordSpec{
	{Kind: KindFile, Keyword: "file"},
	{Kind: KindRef, Keyword: "ref", Aliases: []string{"reference", "references", "project"}},
	{Kind: KindAttach, Keyword: "attach", Aliases: []string{"att", "attch", "attche", "attaches", "attahes", "dir"}},
	{Kind: KindSee, Keyword: "see", Aliases: []string{"look"}},
	{Kind: KindChat, Keyword: "chat"},
	{Kind: KindLib, Keyword: "lib", Aliases: []string{"library"}},
	{Kind: KindTodo, Keyword: "todo", Aliases: []string{"TODO"}},
	{Kind: KindTask, Keyword: "task"},
}

// Keywords returns the directive vocabulary, so a menu — or a test — can
// enumerate it without hardcoding a second copy.
func Keywords() []KeywordSpec { return append([]KeywordSpec(nil), keywords...) }

var kindAliases = func() map[string]Kind {
	table := make(map[string]Kind)
	for _, spec := range keywords {
		table[spec.Keyword] = spec.Kind
		for _, alias := range spec.Aliases {
			table[alias] = spec.Kind
		}
	}
	return table
}()

func typedKeywordAlternation() string {
	all := make([]string, 0, len(kindAliases))
	for keyword := range kindAliases {
		all = append(all, keyword)
	}
	sort.Slice(all, func(i, j int) bool {
		if len(all[i]) != len(all[j]) {
			return len(all[i]) > len(all[j])
		}
		return all[i] < all[j]
	})
	return strings.Join(all, "|")
}

// pattern recognizes both canonical markers and typed aliases. Canonical forms
// accept only canonical kind names; aliases are normalized by kindAliases.
var pattern = regexp.MustCompile(`@\{\[(file|ref|attach|see|chat|lib|todo|task)\]([^{}\n]*)\}|@(` + typedKeywordAlternation() + `):(?:<<([^<>\n]*)>>|([^\s<>{}(),;:!?"'` + "`" + `]*))`)

var namePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
