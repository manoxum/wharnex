package directives

import (
	"reflect"
	"testing"
)

// Both spellings parse the same, because a prompt mixing them is the ordinary
// case: a canonicalized prompt that the operator then edits by hand.
func TestParseReadsBothSpellings(t *testing.T) {
	parsed := Parse("compare @file:services/app/a.ts with @{[ref]flowcore/lib/b.ts} and @ref:siage")
	if len(parsed) != 3 {
		t.Fatalf("parsed=%#v want 3", parsed)
	}
	if parsed[0].Kind != KindFile || parsed[0].Path != "services/app/a.ts" {
		t.Fatalf("first=%#v", parsed[0])
	}
	if parsed[1].Kind != KindRef || parsed[1].Project != "flowcore" || parsed[1].Path != "lib/b.ts" {
		t.Fatalf("second=%#v", parsed[1])
	}
	if parsed[2].Kind != KindRef || parsed[2].Project != "siage" || parsed[2].Path != "" {
		t.Fatalf("third=%#v", parsed[2])
	}
}

// The offsets are what let the composer paint a chip exactly where the operator
// typed it, so they have to be the real byte range of the whole directive.
func TestParseReportsTheRangeItOccupied(t *testing.T) {
	text := "see @file:a.ts now"
	parsed := Parse(text)
	if len(parsed) != 1 {
		t.Fatalf("parsed=%#v", parsed)
	}
	if text[parsed[0].Start:parsed[0].End] != "@file:a.ts" {
		t.Fatalf("range=%q", text[parsed[0].Start:parsed[0].End])
	}
}

// A near-miss is prose, not a broken directive. Repairing it is how a traversal
// turns into a resolved path.
func TestParseLeavesMalformedDirectivesAlone(t *testing.T) {
	for _, text := range []string{
		"@file:../../etc/passwd", "@file:/etc/passwd", "@ref:../etc",
		"@ref:.", "@file:", "@ref:", "@{[file]}", "@{[ref]}",
	} {
		if parsed := Parse(text); len(parsed) != 0 {
			t.Fatalf("%q must not parse as a directive, got %#v", text, parsed)
		}
	}
}

// An unbracketed directive ends at whitespace, because it sits inside a
// sentence: "change @ref:core and then stop" refers to `core`, not to the rest
// of the line. A value that genuinely contains a space needs the bracketed
// form, which is what it is for.
func TestParseStopsAnUnbracketedDirectiveAtWhitespace(t *testing.T) {
	parsed := Parse("change @ref:core and then stop")
	if len(parsed) != 1 || parsed[0].Project != "core" || parsed[0].Path != "" {
		t.Fatalf("parsed=%#v", parsed)
	}
	bracketed := Parse("change @ref:<<core/a b.md>> and stop")
	if len(bracketed) != 1 || bracketed[0].Path != "a b.md" {
		t.Fatalf("bracketed=%#v", bracketed)
	}
	// A brace ends it for the same reason: the canonical form is delimited by
	// braces, so a value containing one could not survive a round trip.
	braced := Parse("@file:a{b}.ts")
	if len(braced) != 1 || braced[0].Path != "a" {
		t.Fatalf("braced=%#v", braced)
	}
}

// Whatever the operator typed, what the model reads and what the engine
// re-parses on a continuation must be the same string.
func TestCanonicalizeRewritesOnlyTheDirectives(t *testing.T) {
	got := Canonicalize("fix @file:<<src/a b.ts>> using @ref:flowcore and keep @notadirective as is")
	want := "fix @{[file]src/a b.ts} using @{[ref]flowcore} and keep @notadirective as is"
	if got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
}

// Canonicalizing twice changes nothing: a continuation re-submits a prompt that
// has already been through this once.
func TestCanonicalizeIsIdempotent(t *testing.T) {
	once := Canonicalize("use @file:a.ts and @ref:core/b.ts")
	if twice := Canonicalize(once); twice != once {
		t.Fatalf("second pass changed the prompt:\n%q\n%q", once, twice)
	}
}

func TestValuesReturnsDistinctValuesInOrder(t *testing.T) {
	parsed := Parse("@file:b.ts @ref:core @file:a.ts @file:b.ts")
	if got := Values(parsed, KindFile); !reflect.DeepEqual(got, []string{"b.ts", "a.ts"}) {
		t.Fatalf("values=%#v", got)
	}
	if got := Values(parsed, KindRef); !reflect.DeepEqual(got, []string{"core"}) {
		t.Fatalf("values=%#v", got)
	}
}

// A prompt cannot be turned into unbounded downstream work by pasting.
func TestParseIsBounded(t *testing.T) {
	text := ""
	for i := 0; i < MaxDirectives+10; i++ {
		text += "@file:a.ts "
	}
	if parsed := Parse(text); len(parsed) != MaxDirectives {
		t.Fatalf("parsed %d want %d", len(parsed), MaxDirectives)
	}
}

// Aliases exist so an operator does not have to remember one exact word to
// mean "another project" or "something outside the project". They are typed
// spellings only: whichever one is used, the marker Wharnex writes back is
// always the canonical keyword.
func TestParseAcceptsRefAndAttachAliases(t *testing.T) {
	for _, alias := range []string{"ref", "reference", "references", "project"} {
		parsed := Parse("@" + alias + ":flowcore")
		if len(parsed) != 1 || parsed[0].Kind != KindRef || parsed[0].Project != "flowcore" {
			t.Fatalf("alias %q: parsed=%#v", alias, parsed)
		}
	}
	for _, alias := range []string{"attach", "att", "attch", "attche", "attaches", "attahes", "dir"} {
		parsed := Parse("@" + alias + ":/srv/contracts")
		if len(parsed) != 1 || parsed[0].Kind != KindAttach || parsed[0].Path != "/srv/contracts" {
			t.Fatalf("alias %q: parsed=%#v", alias, parsed)
		}
	}
}

// Whatever alias was typed, the canonical form always uses the primary
// keyword — there is exactly one spelling the model and a re-parsed
// continuation ever have to expect.
func TestCanonicalizeNormalizesAliasesToThePrimaryKeyword(t *testing.T) {
	got := Canonicalize("olha @project:flowcore e @dir:/srv/sdk")
	want := "olha @{[ref]flowcore} e @{[attach]/srv/sdk}"
	if got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
}

// @see names an already-attached file by name only — it carries no location,
// unlike the other three kinds, since the attachment's bytes travel through a
// separate transport this package never sees.
func TestParseAcceptsSeeAndLookAsTheSameKind(t *testing.T) {
	for _, alias := range []string{"see", "look"} {
		parsed := Parse("@" + alias + ":diagram.png")
		if len(parsed) != 1 || parsed[0].Kind != KindSee || parsed[0].Value != "diagram.png" || parsed[0].Path != "diagram.png" {
			t.Fatalf("alias %q: parsed=%#v", alias, parsed)
		}
	}
	got := Canonicalize("compare @look:before.png with @see:after.png")
	want := "compare @{[see]before.png} with @{[see]after.png}"
	if got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
}

func TestSeeRequiresQualifiedContextPaths(t *testing.T) {
	for _, text := range []string{"@see:../secrets.txt", "@see:dir/file.png", "@see:a\\b"} {
		if parsed := Parse(text); len(parsed) != 0 {
			t.Fatalf("%q must not parse as a directive, got %#v", text, parsed)
		}
	}
	for input, wantSource := range map[string]string{
		"@{[see]project|src/App.tsx}":                   "project",
		"@{[see]ref|flowcore|services/api/auth.go}":     "ref",
		"@{[see]attach|/srv/contracts|openapi/api.yml}": "attach",
		"@{[see]upload|diagram.png}":                    "upload",
	} {
		parsed := Parse(input)
		if len(parsed) != 1 || parsed[0].Source != wantSource {
			t.Fatalf("%q parsed=%#v", input, parsed)
		}
	}
}

func TestRefCarriesOptionalRequestLocalSelection(t *testing.T) {
	plain := Parse("@{[ref]flowcore}")[0]
	if plain.Rules.AutoExclude || len(plain.Rules.Include) != 0 {
		t.Fatalf("plain ref must inherit project config: %#v", plain)
	}
	configured := Parse("@{[ref]flowcore|!auto|+src/**|-dist/**}")[0]
	if configured.Rules.AutoExclude || !reflect.DeepEqual(configured.Rules.Include, []string{"src/**"}) || !reflect.DeepEqual(configured.Rules.Exclude, []string{"dist/**"}) {
		t.Fatalf("configured=%#v", configured)
	}
}

// Keywords is the single source of truth the regex is built from; a test that
// walks it end to end catches a keyword added to the table but never wired
// into parsing.
func TestEveryKeywordAndAliasParses(t *testing.T) {
	for _, spec := range Keywords() {
		for _, word := range append([]string{spec.Keyword}, spec.Aliases...) {
			value := "flowcore"
			if spec.Kind == KindAttach {
				value = "/srv/x"
			}
			parsed := Parse("@" + word + ":" + value)
			if len(parsed) != 1 || parsed[0].Kind != spec.Kind {
				t.Fatalf("keyword %q (kind %s): parsed=%#v", word, spec.Kind, parsed)
			}
		}
	}
}
