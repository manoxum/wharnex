package directives

import (
	"reflect"
	"testing"
)

// The rules travel inside the marker so the prompt text stays the whole state:
// what is stored, re-read on a continuation and shown in a transcript is
// exactly the selection the request was sent with.
func TestParseAttachCarriesItsSelectionInTheMarker(t *testing.T) {
	parsed := Parse("junta @{[attach]/srv/contracts|+openapi/**|-**/*.bak} ao contexto")
	if len(parsed) != 1 {
		t.Fatalf("parsed=%#v", parsed)
	}
	directive := parsed[0]
	if directive.Kind != KindAttach || directive.Path != "/srv/contracts" {
		t.Fatalf("directive=%#v", directive)
	}
	if !reflect.DeepEqual(directive.Rules.Include, []string{"openapi/**"}) {
		t.Fatalf("include=%#v", directive.Rules.Include)
	}
	if !reflect.DeepEqual(directive.Rules.Exclude, []string{"**/*.bak"}) {
		t.Fatalf("exclude=%#v", directive.Rules.Exclude)
	}
	if !directive.Rules.AutoExclude {
		t.Fatal("automatic pruning is the default for an external folder")
	}
}

func TestParseAttachDefaultsAndAutoOptOut(t *testing.T) {
	plain := Parse("@attach:/srv/contracts")
	if len(plain) != 1 || !plain[0].Rules.IsDefault() {
		t.Fatalf("plain=%#v", plain)
	}
	opted := Parse("@{[attach]/srv/sdk|!auto}")
	if len(opted) != 1 || opted[0].Rules.AutoExclude {
		t.Fatalf("opted=%#v", opted)
	}
}

// An attachment names something outside the project, so its path is absolute by
// construction. A relative one would resolve against whatever working directory
// happened to be current — not a place the operator can reason about from the
// composer — and a traversal is never repaired into a resolved path.
func TestParseAttachRefusesWhatItCannotResolveHonestly(t *testing.T) {
	for _, text := range []string{
		"@attach:relative/path", "@attach:/srv/../etc", "@attach:", "@{[attach]}",
		"@{[attach]/srv/x|+../escape}", "@{[attach]/srv/x|?bad}",
	} {
		if parsed := Parse(text); len(parsed) != 0 {
			t.Fatalf("%q must not parse as an attachment, got %#v", text, parsed)
		}
	}
}

// Canonicalizing is idempotent for attachments too, rules included: a
// continuation re-submits a prompt that has already been through this once.
func TestCanonicalizeAttachIsStable(t *testing.T) {
	once := Canonicalize("usa @attach:/srv/contracts e @{[attach]/srv/sdk|+src/**}")
	if once != "usa @{[attach]/srv/contracts} e @{[attach]/srv/sdk|+src/**}" {
		t.Fatalf("once=%q", once)
	}
	if twice := Canonicalize(once); twice != once {
		t.Fatalf("second pass changed the prompt:\n%q\n%q", once, twice)
	}
}
